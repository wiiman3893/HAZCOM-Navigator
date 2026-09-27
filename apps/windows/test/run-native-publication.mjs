import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
assert.equal(process.env.GCLOUD_PROJECT,'demo-hazcom-navigator');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST','FIREBASE_STORAGE_EMULATOR_HOST'])assert.match(process.env[key]??'',/^(localhost|127\.0\.0\.1):\d+$/);
const result=spawnSync('cargo',['test','--manifest-path','apps/windows/src-tauri/Cargo.toml','--lib','javascript_authoring_and_backup_round_trip_through_native_sessions','--','--nocapture'],{stdio:'inherit',env:{...process.env,HAZCOM_NATIVE_PUBLICATION_EMULATOR:'1'}});
if(result.error)throw result.error;
process.exit(result.status??1);
