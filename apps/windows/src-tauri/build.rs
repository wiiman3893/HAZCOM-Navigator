fn main() {
    println!("cargo:rerun-if-env-changed=HAZCOM_OFFLINE_LEASE_ENVIRONMENT");
    println!("cargo:rerun-if-env-changed=HAZCOM_OFFLINE_LEASE_PUBLIC_KEYS_JSON");
    // Non-secret build provenance; never embed environment dumps or filesystem paths.
    if let Ok(output)=std::process::Command::new("git").args(["rev-parse","HEAD"]).output(){
        let sha=String::from_utf8_lossy(&output.stdout).trim().to_string();
        if output.status.success()&&sha.len()==40&&sha.bytes().all(|b|b.is_ascii_hexdigit()){
            println!("cargo:rustc-env=HAZCOM_BUILD_ID={sha}");
        }
    }
    tauri_build::build()
}
