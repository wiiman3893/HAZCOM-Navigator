//! Bounded reproduction timelines; no database, credential, cloud or caller-path API.
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{
    collections::VecDeque,
    fs::{self, File, OpenOptions},
    io::{BufWriter, Write},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc::{self, SyncSender},
        Arc, Mutex,
    },
    time::{Duration, SystemTime, UNIX_EPOCH},
};
use tauri::Manager;
const MAX_EVENTS: u64 = 4 * 1024 * 1024;
const MAX_SESSIONS: usize = 32;
const RECENT: usize = 64;
type Result<T> = std::result::Result<T, String>;
fn failure() -> String {
    "STORAGE_UNAVAILABLE".into()
}
fn now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
fn digest(bytes: &[u8]) -> String {
    format!("{:x}", Sha256::digest(bytes))
}
fn contract() -> &'static Value {
    static C: std::sync::OnceLock<Value> = std::sync::OnceLock::new();
    C.get_or_init(|| {
        serde_json::from_str(include_str!("../../src/diagnostics/contract.json"))
            .expect("compiled diagnostics contract")
    })
}
fn allowed(group: &str, value: &str) -> bool {
    contract()[group]
        .as_array()
        .is_some_and(|a| a.iter().any(|v| v.as_str() == Some(value)))
}
fn id_ok(id: &str) -> bool {
    id.len() == 37 && id.starts_with("diag_") && id[5..].bytes().all(|c| c.is_ascii_hexdigit())
}
fn hex(value: &str, len: usize) -> bool {
    value.len() == len && value.bytes().all(|c| c.is_ascii_hexdigit())
}

#[derive(Clone, Debug, Default, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Input {
    pub operation: String,
    pub outcome: String,
    pub screen: Option<String>,
    pub company: Option<String>,
    pub workspace: Option<String>,
    pub entity: Option<String>,
    pub duration_ms: Option<u64>,
    pub count: Option<u64>,
    pub bytes: Option<u64>,
    pub read_only: Option<bool>,
    pub role: Option<String>,
    pub phase: Option<String>,
    pub reason: Option<String>,
    pub fields: Option<Vec<String>>,
}
impl Input {
    fn event(operation: &str, outcome: &str) -> Self {
        Self {
            operation: operation.into(),
            outcome: outcome.into(),
            ..Self::default()
        }
    }
    fn clean(mut self, session: &str, export: bool) -> Option<Self> {
        if !allowed("operations", &self.operation) || !allowed("outcomes", &self.outcome) {
            return None;
        }
        self.screen = self.screen.filter(|s| allowed("screens", s));
        self.phase = self.phase.filter(|s| allowed("phases", s));
        self.role = self
            .role
            .filter(|s| ["member", "manager", "administrator"].contains(&s.as_str()));
        self.reason = self.reason.map(|s| {
            if allowed("reasons", &s) {
                s
            } else {
                "OPERATION_FAILED".into()
            }
        });
        for id in [&mut self.company, &mut self.workspace, &mut self.entity] {
            *id = id.as_ref().and_then(|s| {
                if export {
                    hex(s, 24).then(|| s.clone())
                } else {
                    Some(
                        digest(
                            format!("{session}\0{}", s.chars().take(512).collect::<String>())
                                .as_bytes(),
                        )[..24]
                            .into(),
                    )
                }
            });
        }
        self.fields = self.fields.map(|f| {
            f.into_iter()
                .filter(|s| allowed("fields", s))
                .take(32)
                .collect()
        });
        self.duration_ms = self.duration_ms.map(|n| n.min(86_400_000));
        self.count = self.count.map(|n| n.min(1_000_000_000));
        self.bytes = self.bytes.map(|n| n.min(1_000_000_000));
        Some(self)
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Event {
    schema_version: u32,
    session_id: String,
    sequence: u64,
    timestamp_ms: u64,
    event: Input,
    recent_from: Option<u64>,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Manifest {
    package_type: String,
    schema_version: u32,
    session_id: String,
    state: String,
    started_ms: u64,
    ended_ms: Option<u64>,
    app_version: String,
    build_id: String,
    os: String,
    architecture: String,
    launch: String,
    correlation: Option<String>,
    screenshots: bool,
    event_count: u64,
    dropped_events: u64,
    screenshot_count: u64,
    failure: Option<String>,
}
#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    current: Option<Manifest>,
    sessions: Vec<Manifest>,
    failure: Option<String>,
}
struct Recording {
    manifest: Manifest,
    writer: BufWriter<File>,
    size: u64,
    recent: VecDeque<u64>,
    _lock: File,
}
enum Command {
    Start(bool, Option<String>, mpsc::Sender<Result<Value>>),
    Events(String, Vec<Input>),
    Mark(Input, mpsc::Sender<Result<Value>>),
    Stop(bool, mpsc::Sender<Result<Value>>),
    Export(String, mpsc::Sender<Result<Value>>),
}
#[derive(Clone)]
pub struct Diagnostics {
    sender: SyncSender<Command>,
    status: Arc<Mutex<Status>>,
    dropped: Arc<AtomicU64>,
    pub root: PathBuf,
}
struct Writer {
    root: PathBuf,
    active: Option<Recording>,
    status: Arc<Mutex<Status>>,
    dropped: Arc<AtomicU64>,
}

fn safe_dir(path: &Path) -> Result<()> {
    for ancestor in path.ancestors() {
        if let Ok(meta) = fs::symlink_metadata(ancestor) {
            #[cfg(windows)]
            {
                use std::os::windows::fs::MetadataExt;
                if meta.file_attributes() & 0x400 != 0 {
                    return Err(failure());
                }
            }
            if meta.file_type().is_symlink() {
                return Err(failure());
            }
        }
    }
    fs::create_dir_all(path).map_err(|_| failure())
}
fn bounded_read(path: &Path, limit: u64) -> Result<Vec<u8>> {
    let m = fs::symlink_metadata(path).map_err(|_| failure())?;
    if !m.is_file() || m.file_type().is_symlink() || m.len() > limit {
        return Err("CORRUPT_SESSION".into());
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if m.file_attributes() & 0x400 != 0 {
            return Err("CORRUPT_SESSION".into());
        }
    }
    fs::read(path).map_err(|_| failure())
}
fn save_manifest(root: &Path, m: &Manifest) -> Result<()> {
    let folder = root.join("sessions").join(&m.session_id);
    safe_dir(&folder)?;
    let pending = folder.join(format!("metadata-{:016x}.pending", rand::random::<u64>()));
    let mut f = OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&pending)
        .map_err(|_| failure())?;
    f.write_all(&serde_json::to_vec(m).map_err(|_| failure())?)
        .map_err(|_| failure())?;
    f.sync_all().map_err(|_| failure())?;
    drop(f);
    fs::rename(&pending, folder.join("manifest.json")).map_err(|_| failure())
}
impl Diagnostics {
    pub fn new(root: PathBuf) -> Self {
        let (sender, receiver) = mpsc::sync_channel(16);
        let status = Arc::new(Mutex::new(Status::default()));
        let dropped = Arc::new(AtomicU64::new(0));
        let mut w = Writer {
            root: root.clone(),
            active: None,
            status: status.clone(),
            dropped: dropped.clone(),
        };
        std::thread::spawn(move || {
            if let Err(code) = w.recover() {
                w.fail(&code);
            }
            loop {
                match receiver.recv_timeout(Duration::from_millis(500)) {
                    Ok(Command::Start(a, l, r)) => {
                        let result = w.start(a, l);
                        w.report(&result);
                        let _ = r.send(result);
                    }
                    Ok(Command::Events(id, events)) => {
                        if w.active
                            .as_ref()
                            .is_some_and(|a| a.manifest.session_id == id)
                        {
                            for e in events {
                                w.append(e, false, true);
                            }
                        }
                    }
                    Ok(Command::Mark(mut e, r)) => {
                        e.operation = "diagnostics".into();
                        e.outcome = "marked".into();
                        w.append(e, true, false);
                        let _ = r.send(Ok(json!(w.status.lock().unwrap().current)));
                    }
                    Ok(Command::Stop(s, r)) => {
                        let result = w.stop(s);
                        w.report(&result);
                        let _ = r.send(result);
                    }
                    Ok(Command::Export(id, r)) => {
                        let result = w.export(&id);
                        w.report(&result);
                        let _ = r.send(result);
                    }
                    Err(mpsc::RecvTimeoutError::Disconnected) => {
                        let _ = w.stop(true);
                        break;
                    }
                    Err(mpsc::RecvTimeoutError::Timeout) => {}
                }
                if let Some(a) = w.active.as_mut() {
                    if a.writer.flush().is_err() {
                        w.fail("STORAGE_UNAVAILABLE");
                    }
                }
            }
        });
        Self {
            sender,
            status,
            dropped,
            root,
        }
    }
    fn request(&self, make: impl FnOnce(mpsc::Sender<Result<Value>>) -> Command) -> Result<Value> {
        let (tx, rx) = mpsc::channel();
        self.sender
            .try_send(make(tx))
            .map_err(|_| "QUEUE_FULL".to_string())?;
        rx.recv_timeout(Duration::from_secs(3))
            .map_err(|_| failure())?
    }
    pub fn start(&self, auto: bool, label: Option<String>) -> Result<Value> {
        self.request(|r| Command::Start(auto, label, r))
    }
    pub fn stop(&self, shutdown: bool) -> Result<Value> {
        self.request(|r| Command::Stop(shutdown, r))
    }
    pub fn events(&self, events: Vec<Input>) {
        let id = {
            let s = self.status.lock().unwrap();
            s.current
                .as_ref()
                .filter(|m| m.state == "active")
                .map(|m| m.session_id.clone())
        };
        let Some(id) = id else {
            return;
        };
        let count = events.len() as u64;
        if count > 64 {
            self.dropped.fetch_add(count, Ordering::Relaxed);
            return;
        }
        let clean: Vec<_> = events
            .into_iter()
            .filter_map(|e| e.clean(&id, false))
            .collect();
        self.dropped
            .fetch_add(count - clean.len() as u64, Ordering::Relaxed);
        let accepted = clean.len() as u64;
        if self.sender.try_send(Command::Events(id, clean)).is_err() {
            self.dropped.fetch_add(accepted, Ordering::Relaxed);
        }
    }
    pub fn status(&self) -> Status {
        let mut s = self.status.lock().unwrap().clone();
        if let Some(m) = s.current.as_mut() {
            m.dropped_events = self.dropped.load(Ordering::Relaxed);
        }
        s
    }
}
impl Writer {
    fn fail(&mut self, code: &str) {
        let mut s = self.status.lock().unwrap();
        s.failure = Some(code.into());
        if let Some(a) = self.active.as_mut() {
            a.manifest.failure = Some(code.into());
            s.current = Some(a.manifest.clone());
        }
    }
    fn report(&mut self, r: &Result<Value>) {
        if let Err(code) = r {
            self.fail(code);
        }
    }
    fn read_manifest(&self, id: &str) -> Result<Manifest> {
        if !id_ok(id) {
            return Err("CORRUPT_SESSION".into());
        }
        let folder = self.root.join("sessions").join(id);
        if !folder.is_dir() {
            return Err("CORRUPT_SESSION".into());
        }
        safe_dir(&folder)?;
        let mut m: Manifest =
            serde_json::from_slice(&bounded_read(&folder.join("manifest.json"), 8192)?)
                .map_err(|_| "CORRUPT_SESSION".to_string())?;
        if m.session_id != id
            || m.schema_version != 1
            || !["active", "stopped", "interrupted"].contains(&m.state.as_str())
        {
            return Err("CORRUPT_SESSION".into());
        }
        // Sanitize even locally modified prior metadata before returning it to the UI.
        m.app_version = env!("CARGO_PKG_VERSION").into();
        m.build_id = option_env!("HAZCOM_BUILD_ID")
            .unwrap_or("unidentified")
            .into();
        m.os = std::env::consts::OS.into();
        m.architecture = std::env::consts::ARCH.into();
        m.package_type = "hazcom-diagnostic-session".into();
        m.launch = if m.launch == "automated" {
            "automated"
        } else {
            "manual"
        }
        .into();
        m.correlation = m.correlation.filter(|s| hex(s, 64));
        m.failure = m.failure.filter(|s| allowed("reasons", s));
        m.screenshots = false;
        m.screenshot_count = 0;
        Ok(m)
    }
    fn recover(&mut self) -> Result<()> {
        safe_dir(&self.root)?;
        safe_dir(&self.root.join("sessions"))?;
        let mut sessions = Vec::new();
        let mut bad = false;
        for e in fs::read_dir(self.root.join("sessions"))
            .map_err(|_| failure())?
            .take(MAX_SESSIONS + 1)
        {
            let e = e.map_err(|_| failure())?;
            let id = e.file_name().to_string_lossy().into_owned();
            let r = (|| -> Result<Option<Manifest>> {
                let mut m = self.read_manifest(&id)?;
                if m.state == "active" {
                    let lock_path = e.path().join("session.lock");
                    if lock_path.exists() {
                        let meta = fs::symlink_metadata(&lock_path).map_err(|_| failure())?;
                        if !meta.is_file() || meta.file_type().is_symlink() || meta.len() != 0 {
                            return Err("CORRUPT_SESSION".into());
                        }
                        #[cfg(windows)]
                        {
                            use std::os::windows::fs::MetadataExt;
                            if meta.file_attributes() & 0x400 != 0 {
                                return Err("CORRUPT_SESSION".into());
                            }
                        }
                    }
                    let lock = OpenOptions::new()
                        .read(true)
                        .write(true)
                        .create(true)
                        .truncate(false)
                        .open(lock_path)
                        .map_err(|_| failure())?;
                    if lock.try_lock().is_err() {
                        return Ok(None);
                    } // Another live app owns this recording.
                    m.state = "interrupted".into();
                    m.ended_ms = Some(now());
                    save_manifest(&self.root, &m)?;
                }
                Ok(Some(m))
            })();
            match r {
                Ok(Some(m)) => sessions.push(m),
                Ok(None) => {}
                Err(_) => bad = true,
            }
        }
        sessions.sort_by_key(|m| std::cmp::Reverse(m.started_ms));
        self.status.lock().unwrap().sessions = sessions;
        if bad {
            Err("CORRUPT_SESSION".into())
        } else {
            Ok(())
        }
    }
    fn start(&mut self, auto: bool, label: Option<String>) -> Result<Value> {
        if self.active.is_some() {
            return Err("ALREADY_ACTIVE".into());
        }
        if fs::read_dir(self.root.join("sessions"))
            .map_err(|_| failure())?
            .take(MAX_SESSIONS)
            .count()
            >= MAX_SESSIONS
        {
            return Err("STORAGE_LIMIT".into());
        }
        let id = format!("diag_{:032x}", rand::random::<u128>());
        let correlation = label
            .filter(|s| !s.is_empty() && s.len() <= 128)
            .map(|s| digest(s.as_bytes()));
        let m = Manifest {
            package_type: "hazcom-diagnostic-session".into(),
            schema_version: 1,
            session_id: id.clone(),
            state: "active".into(),
            started_ms: now(),
            ended_ms: None,
            app_version: env!("CARGO_PKG_VERSION").into(),
            build_id: option_env!("HAZCOM_BUILD_ID")
                .unwrap_or("unidentified")
                .into(),
            os: std::env::consts::OS.into(),
            architecture: std::env::consts::ARCH.into(),
            launch: if auto { "automated" } else { "manual" }.into(),
            correlation,
            screenshots: false,
            event_count: 0,
            dropped_events: 0,
            screenshot_count: 0,
            failure: None,
        };
        let folder = self.root.join("sessions").join(&id);
        safe_dir(&folder)?;
        let lock = OpenOptions::new()
            .read(true)
            .write(true)
            .create_new(true)
            .open(folder.join("session.lock"))
            .map_err(|_| failure())?;
        lock.try_lock().map_err(|_| failure())?;
        save_manifest(&self.root, &m)?;
        let file = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(folder.join("app-events.jsonl"))
            .map_err(|_| failure())?;
        self.dropped.store(0, Ordering::Relaxed);
        self.active = Some(Recording {
            manifest: m,
            writer: BufWriter::new(file),
            size: 0,
            recent: VecDeque::new(),
            _lock: lock,
        });
        self.status.lock().unwrap().failure = None;
        self.append(Input::event("diagnostics", "started"), false, false);
        if auto {
            self.append(Input::event("application", "started"), false, false);
        }
        Ok(json!(self.status.lock().unwrap().current))
    }
    fn append(&mut self, input: Input, marker: bool, clean: bool) {
        let Some(a) = self.active.as_mut() else {
            return;
        };
        let Some(details) = input.clean(&a.manifest.session_id, clean) else {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            return;
        };
        let e = Event {
            schema_version: 1,
            session_id: a.manifest.session_id.clone(),
            sequence: a.manifest.event_count + 1,
            timestamp_ms: now(),
            event: details,
            recent_from: if marker {
                a.recent.front().copied()
            } else {
                None
            },
        };
        let Ok(mut bytes) = serde_json::to_vec(&e) else {
            return;
        };
        bytes.push(b'\n');
        if a.size + bytes.len() as u64 > MAX_EVENTS {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            self.fail("STORAGE_LIMIT");
            return;
        }
        if a.writer.write_all(&bytes).is_err() {
            self.dropped.fetch_add(1, Ordering::Relaxed);
            self.fail("STORAGE_UNAVAILABLE");
            return;
        }
        a.size += bytes.len() as u64;
        a.manifest.event_count = e.sequence;
        a.manifest.dropped_events = self.dropped.load(Ordering::Relaxed);
        a.recent.push_back(e.sequence);
        if a.recent.len() > RECENT {
            a.recent.pop_front();
        }
        self.status.lock().unwrap().current = Some(a.manifest.clone());
    }
    fn stop(&mut self, shutdown: bool) -> Result<Value> {
        if self.active.is_none() {
            return Ok(Value::Null);
        }
        if shutdown {
            self.append(Input::event("application", "shutdown"), false, false);
        }
        self.append(Input::event("diagnostics", "stopped"), false, false);
        let mut a = self.active.take().unwrap();
        let flushed = a.writer.flush().is_ok();
        a.manifest.state = if flushed { "stopped" } else { "interrupted" }.into();
        a.manifest.ended_ms = Some(now());
        a.manifest.dropped_events = self.dropped.load(Ordering::Relaxed);
        if !flushed {
            a.manifest.failure = Some(failure());
        }
        let saved = save_manifest(&self.root, &a.manifest);
        {
            let mut s = self.status.lock().unwrap();
            s.current = Some(a.manifest.clone());
            s.sessions.insert(0, a.manifest.clone());
        }
        saved?;
        Ok(json!(a.manifest))
    }
    fn export(&mut self, id: &str) -> Result<Value> {
        if !id_ok(id)
            || self
                .active
                .as_ref()
                .is_some_and(|a| a.manifest.session_id == id)
        {
            return Err("SESSION_NOT_STOPPED".into());
        }
        let folder = self.root.join("sessions").join(id);
        let mut m = self.read_manifest(id)?;
        if m.state == "active" {
            return Err("SESSION_NOT_STOPPED".into());
        }
        let raw = bounded_read(&folder.join("app-events.jsonl"), MAX_EVENTS)?;
        let mut events = Vec::new();
        let mut count = 0;
        for line in raw.split_inclusive(|b| *b == b'\n') {
            // An interrupted final write may leave a partial last line; preserve the durable prefix.
            if !line.ends_with(b"\n") && m.state == "interrupted" {
                break;
            }
            let mut e: Event =
                serde_json::from_slice(line).map_err(|_| "CORRUPT_SESSION".to_string())?;
            if e.session_id != id || e.sequence != count + 1 || e.schema_version != 1 {
                return Err("CORRUPT_SESSION".into());
            }
            e.event = e.event.clean(id, true).ok_or("CORRUPT_SESSION")?;
            serde_json::to_writer(&mut events, &e).map_err(|_| failure())?;
            events.push(b'\n');
            count += 1;
        }
        m.event_count = count;
        let summary = json!({"schemaVersion":1,"sessionId":id,"eventCount":count,"droppedEvents":m.dropped_events,"state":m.state,"eventsSha256":digest(&events),"eventsBytes":events.len(),"screenshotStatus":"unsupported"});
        let zip = make_zip(&[
            (
                "manifest.json",
                serde_json::to_vec(&m).map_err(|_| failure())?,
            ),
            ("app-events.jsonl", events),
            (
                "summary.json",
                serde_json::to_vec(&summary).map_err(|_| failure())?,
            ),
        ])?;
        let exports = self.root.join("exports");
        safe_dir(&exports)?;
        let name = format!("hazcom-diagnostic-session-{id}.zip");
        let path = exports.join(&name);
        if path.exists() {
            if bounded_read(&path, MAX_EVENTS + 16384)? == zip {
                return Ok(json!({"filename":name,"bytes":zip.len(),"sha256":digest(&zip)}));
            }
            return Err("EXPORT_CONFLICT".into());
        }
        let pending = exports.join(format!("export-{:016x}.pending", rand::random::<u64>()));
        let mut f = OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&pending)
            .map_err(|_| failure())?;
        f.write_all(&zip).map_err(|_| failure())?;
        f.sync_all().map_err(|_| failure())?;
        drop(f);
        fs::rename(pending, path).map_err(|_| failure())?;
        Ok(json!({"filename":name,"bytes":zip.len(),"sha256":digest(&zip)}))
    }
}
// Store-only ZIP, matching the offline toolbox convention; fixed safe members only.
fn make_zip(files: &[(&str, Vec<u8>)]) -> Result<Vec<u8>> {
    fn u16le(b: &mut Vec<u8>, n: u16) {
        b.extend(n.to_le_bytes());
    }
    fn u32le(b: &mut Vec<u8>, n: u32) {
        b.extend(n.to_le_bytes());
    }
    let mut out = Vec::new();
    let mut central = Vec::new();
    for (name, data) in files {
        if !name
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || b"._-".contains(&c))
            || data.len() > MAX_EVENTS as usize
        {
            return Err("STORAGE_LIMIT".into());
        }
        let mut crc = 0xffffffffu32;
        for byte in data {
            crc ^= *byte as u32;
            for _ in 0..8 {
                crc = (crc >> 1) ^ if crc & 1 != 0 { 0xedb88320 } else { 0 };
            }
        }
        crc ^= 0xffffffff;
        let offset = out.len() as u32;
        u32le(&mut out, 0x04034b50);
        u16le(&mut out, 20);
        out.extend([0; 8]);
        u32le(&mut out, crc);
        u32le(&mut out, data.len() as u32);
        u32le(&mut out, data.len() as u32);
        u16le(&mut out, name.len() as u16);
        u16le(&mut out, 0);
        out.extend(name.as_bytes());
        out.extend(data);
        u32le(&mut central, 0x02014b50);
        u16le(&mut central, 20);
        u16le(&mut central, 20);
        central.extend([0; 8]);
        u32le(&mut central, crc);
        u32le(&mut central, data.len() as u32);
        u32le(&mut central, data.len() as u32);
        u16le(&mut central, name.len() as u16);
        central.extend([0; 12]);
        u32le(&mut central, offset);
        central.extend(name.as_bytes());
    }
    let offset = out.len() as u32;
    let size = central.len() as u32;
    out.extend(central);
    u32le(&mut out, 0x06054b50);
    out.extend([0; 4]);
    u16le(&mut out, files.len() as u16);
    u16le(&mut out, files.len() as u16);
    u32le(&mut out, size);
    u32le(&mut out, offset);
    u16le(&mut out, 0);
    Ok(out)
}
#[tauri::command]
pub fn diagnostic_status(state: tauri::State<'_, Diagnostics>) -> Status {
    state.status()
}
#[tauri::command]
pub async fn diagnostic_start(state: tauri::State<'_, Diagnostics>) -> Result<Value> {
    let d = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || d.start(false, None))
        .await
        .map_err(|_| failure())?
}
#[tauri::command]
pub fn diagnostic_events(
    state: tauri::State<'_, Diagnostics>,
    events: Vec<Input>,
    dropped: Option<u64>,
) {
    if state.status().current.is_some_and(|m| m.state == "active") {
        state
            .dropped
            .fetch_add(dropped.unwrap_or(0).min(1_000_000), Ordering::Relaxed);
    }
    state.events(events);
}
#[tauri::command]
pub async fn diagnostic_mark(
    state: tauri::State<'_, Diagnostics>,
    context: Input,
) -> Result<Value> {
    let d = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || d.request(|r| Command::Mark(context, r)))
        .await
        .map_err(|_| failure())?
}
#[tauri::command]
pub async fn diagnostic_stop(state: tauri::State<'_, Diagnostics>) -> Result<Value> {
    let d = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || d.stop(false))
        .await
        .map_err(|_| failure())?
}
#[tauri::command]
pub async fn diagnostic_export(
    state: tauri::State<'_, Diagnostics>,
    session_id: String,
) -> Result<Value> {
    let d = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || d.request(|r| Command::Export(session_id, r)))
        .await
        .map_err(|_| failure())?
}
#[tauri::command]
pub fn diagnostic_open_exports(
    app: tauri::AppHandle,
    state: tauri::State<'_, Diagnostics>,
) -> Result<()> {
    use tauri_plugin_opener::OpenerExt;
    let folder = state.root.join("exports");
    safe_dir(&folder)?;
    app.opener()
        .open_path(folder.to_string_lossy(), None::<&str>)
        .map_err(|_| failure())
}
pub fn setup(app: &mut tauri::App) -> std::result::Result<(), Box<dyn std::error::Error>> {
    let d = Diagnostics::new(app.path().app_data_dir()?.join("diagnostics"));
    let args: Vec<String> = std::env::args().skip(1).collect();
    if args.iter().any(|s| s == "--diagnostics") {
        let label = args
            .windows(2)
            .find(|v| v[0] == "--diagnostic-session")
            .map(|v| v[1].clone());
        let _ = d.start(true, label);
    }
    app.manage(d);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    fn root() -> PathBuf {
        std::env::temp_dir().join(format!(
            "hazcom-diagnostics-test-{:032x}",
            rand::random::<u128>()
        ))
    }
    fn writer(root: PathBuf) -> Writer {
        Writer {
            root,
            active: None,
            status: Arc::new(Mutex::new(Status::default())),
            dropped: Arc::new(AtomicU64::new(0)),
        }
    }
    fn events(w: &Writer, id: &str) -> Vec<Event> {
        fs::read_to_string(w.root.join("sessions").join(id).join("app-events.jsonl"))
            .unwrap()
            .lines()
            .map(|l| serde_json::from_str(l).unwrap())
            .collect()
    }
    #[test]
    fn lifecycle_privacy_mark_export_and_restart() {
        let root = root();
        let mut w = writer(root.clone());
        w.recover().unwrap();
        assert!(w.status.lock().unwrap().current.is_none());
        let started = w.start(false, None).unwrap();
        let id = started["sessionId"].as_str().unwrap();
        assert!(id_ok(id));
        assert!(w.start(false, None).is_err());
        let sentinels: Vec<String> = serde_json::from_str(include_str!(
            "../../../../scripts/diagnostics/privacy-sentinels.json"
        ))
        .unwrap();
        for secret in &sentinels {
            w.append(
                Input {
                    operation: "worker.create".into(),
                    outcome: "succeeded".into(),
                    entity: Some(secret.clone()),
                    company: Some(secret.clone()),
                    workspace: Some(secret.clone()),
                    reason: Some(secret.clone()),
                    role: Some(secret.clone()),
                    screen: Some(secret.clone()),
                    phase: Some(secret.clone()),
                    fields: Some(vec!["email".into(), secret.clone()]),
                    ..Input::default()
                },
                false,
                false,
            );
        }
        w.append(Input::event("diagnostics", "marked"), true, false);
        w.stop(true).unwrap();
        let recorded = events(&w, id);
        assert!(recorded
            .iter()
            .find(|e| e.event.outcome == "marked")
            .unwrap()
            .recent_from
            .is_some());
        assert_eq!(recorded.last().unwrap().event.outcome, "stopped");
        for (i, e) in recorded.iter().enumerate() {
            assert_eq!(e.sequence, i as u64 + 1);
            assert_eq!(e.session_id, id);
        }
        let exported = w.export(id).unwrap();
        let bytes = fs::read(
            root.join("exports")
                .join(exported["filename"].as_str().unwrap()),
        )
        .unwrap();
        for secret in sentinels {
            assert!(!String::from_utf8_lossy(&bytes).contains(&secret));
        }
        assert_eq!(exported, w.export(id).unwrap());
        assert!(w.export("../workspace.db").is_err());
        // Independent standard-library ZIP parser verifies central directory and CRCs.
        let path = root
            .join("exports")
            .join(exported["filename"].as_str().unwrap());
        let result=std::process::Command::new("python").args(["-c","import sys,zipfile,json; z=zipfile.ZipFile(sys.argv[1]); assert z.testzip() is None; assert set(z.namelist())=={'manifest.json','app-events.jsonl','summary.json'}; m=json.loads(z.read('manifest.json')); assert m['state']=='stopped'; assert all(json.loads(l)['sessionId']==m['sessionId'] for l in z.read('app-events.jsonl').splitlines())",path.to_str().unwrap()]).status().unwrap();
        assert!(result.success());
        let mut next = writer(root);
        next.recover().unwrap();
        assert!(next.active.is_none());
        assert_eq!(next.status.lock().unwrap().sessions[0].state, "stopped");
    }
    #[test]
    fn interrupted_prefix_export_and_new_automated_session() {
        let root = root();
        let mut w = writer(root.clone());
        w.recover().unwrap();
        let m = w.start(true, Some("runner-safe-label".into())).unwrap();
        let id = m["sessionId"].as_str().unwrap().to_owned();
        assert_eq!(m["correlation"], digest(b"runner-safe-label"));
        w.active.as_mut().unwrap().writer.flush().unwrap();
        drop(w);
        OpenOptions::new()
            .append(true)
            .open(root.join("sessions").join(&id).join("app-events.jsonl"))
            .unwrap()
            .write_all(b"{partial")
            .unwrap();
        let mut w = writer(root);
        w.recover().unwrap();
        assert!(w.active.is_none());
        assert_eq!(w.status.lock().unwrap().sessions[0].state, "interrupted");
        w.export(&id).unwrap();
        let next = w.start(true, Some("x".repeat(129))).unwrap();
        assert_ne!(next["sessionId"], id);
        assert!(next["correlation"].is_null());
        w.stop(false).unwrap();
    }
    #[test]
    fn bounds_failure_and_nonblocking_queue() {
        let root = root();
        let mut w = writer(root.clone());
        w.recover().unwrap();
        let m = w.start(false, None).unwrap();
        let id = m["sessionId"].as_str().unwrap();
        let begin = std::time::Instant::now();
        for _ in 0..15000 {
            w.append(Input::event("snapshot", "succeeded"), false, false);
        }
        assert!(w.active.as_ref().unwrap().size <= MAX_EVENTS);
        assert!(w.active.as_ref().unwrap().recent.len() <= RECENT);
        assert!(w.dropped.load(Ordering::Relaxed) > 0);
        w.stop(false).unwrap();
        assert!(
            fs::metadata(root.join("sessions").join(id).join("app-events.jsonl"))
                .unwrap()
                .len()
                <= MAX_EVENTS
        );
        println!(
            "diagnostics 15000 events: {} ms, {} bytes, {} dropped",
            begin.elapsed().as_millis(),
            fs::metadata(root.join("sessions").join(id).join("app-events.jsonl"))
                .unwrap()
                .len(),
            w.dropped.load(Ordering::Relaxed)
        );
        assert!(make_zip(&[("../unsafe", vec![])]).is_err());
        assert!(make_zip(&[("events", vec![0; MAX_EVENTS as usize + 1])]).is_err());
        let invalid = root.join("not-a-directory");
        fs::write(&invalid, b"sentinel").unwrap();
        let mut broken = writer(invalid);
        assert!(broken.recover().is_err());
        assert!(broken.start(false, None).is_err());
        assert_eq!(fs::read(root.join("not-a-directory")).unwrap(), b"sentinel");
        let (tx, _rx) = mpsc::sync_channel(1);
        let d = Diagnostics {
            sender: tx,
            status: w.status.clone(),
            dropped: w.dropped.clone(),
            root,
        };
        d.status.lock().unwrap().current.as_mut().unwrap().state = "active".into();
        d.events(vec![Input::event("snapshot", "succeeded")]);
        d.events(vec![Input::event("snapshot", "succeeded")]);
        assert!(d.request(|r| Command::Stop(false, r)).is_err());
    }
    #[test]
    fn corrupt_session_does_not_stop_new_session_or_leak_metadata() {
        let root = root();
        let mut w = writer(root.clone());
        w.recover().unwrap();
        let m = w.start(false, None).unwrap();
        let id = m["sessionId"].as_str().unwrap();
        w.stop(false).unwrap();
        fs::write(
            root.join("sessions").join(id).join("manifest.json"),
            b"secret malformed metadata",
        )
        .unwrap();
        assert!(w.recover().is_err());
        assert!(w.export(id).is_err());
        w.start(false, None).unwrap();
        w.stop(false).unwrap();
    }
    #[test]
    fn another_process_session_is_not_marked_interrupted() {
        let root = root();
        let mut first = writer(root.clone());
        first.recover().unwrap();
        let started = first.start(false, None).unwrap();
        let id = started["sessionId"].as_str().unwrap();
        let mut second = writer(root);
        second.recover().unwrap();
        assert!(second.status.lock().unwrap().sessions.is_empty());
        assert_eq!(second.read_manifest(id).unwrap().state, "active");
        first.stop(false).unwrap();
        second.recover().unwrap();
        assert_eq!(second.status.lock().unwrap().sessions[0].state, "stopped");
    }
    #[test]
    fn write_export_and_retention_failures_preserve_business_files() {
        let root = root();
        let mut w = writer(root.clone());
        w.recover().unwrap();
        let business = root.join("business-sentinel.db");
        fs::write(&business, b"untouched business data").unwrap();
        let m = w.start(false, None).unwrap();
        let id = m["sessionId"].as_str().unwrap();
        w.active.as_mut().unwrap().writer.flush().unwrap();
        // A read-only handle simulates a writer that loses write permission after Start.
        w.active.as_mut().unwrap().writer =
            BufWriter::with_capacity(1, File::open(&business).unwrap());
        w.append(Input::event("worker.create", "succeeded"), false, false);
        assert_eq!(
            w.status.lock().unwrap().failure.as_deref(),
            Some("STORAGE_UNAVAILABLE")
        );
        w.stop(false).unwrap();
        fs::write(root.join("exports"), b"unavailable directory").unwrap();
        assert!(w.export(id).is_err());
        assert_eq!(fs::read(business).unwrap(), b"untouched business data");
        for n in 1..MAX_SESSIONS {
            fs::create_dir(root.join("sessions").join(format!("diag_{n:032x}"))).unwrap();
        }
        assert_eq!(w.start(false, None).unwrap_err(), "STORAGE_LIMIT");
    }
}
