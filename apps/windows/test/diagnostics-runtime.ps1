param([Parameter(Mandatory=$true)][string]$Executable)
$ErrorActionPreference='Stop'
# Launch only our app, never sign in, never open a Company. Native runtime evidence only.
$sessionRoot=Join-Path $env:APPDATA 'com.saturnstraw.hazcomnavigator\diagnostics\sessions'
function Sessions { if(Test-Path -LiteralPath $sessionRoot){Get-ChildItem -LiteralPath $sessionRoot -Directory | ForEach-Object { $file=Join-Path $_.FullName 'manifest.json'; if(Test-Path -LiteralPath $file){Get-Content -LiteralPath $file -Raw | ConvertFrom-Json} }} }
function NewSession($Before){for($i=0;$i -lt 30;$i++){ $new=@(Sessions | Where-Object {$_.sessionId -notin $Before});if($new.Count -eq 1){return $new[0]};Start-Sleep -Milliseconds 200 };throw 'No unique runtime diagnostic session appeared'}
function StopClean($App){for($i=0;$i -lt 30 -and $App.MainWindowHandle -eq 0;$i++){Start-Sleep -Milliseconds 200;$App.Refresh()};if(-not $App.CloseMainWindow()){throw 'Native close request failed'};if(-not $App.WaitForExit(10000)){throw 'Native clean exit timed out'}}
$before=@(Sessions | ForEach-Object {$_.sessionId})
$app=Start-Process -FilePath $Executable -ArgumentList '--diagnostics','--diagnostic-session','runtime-acceptance' -WindowStyle Hidden -PassThru
try{
 $first=NewSession $before
 if($first.state -ne 'active' -or $first.launch -ne 'automated'){throw 'Runtime auto-start failed'}
 StopClean $app
 $finished=Sessions | Where-Object sessionId -eq $first.sessionId
 if($finished.state -ne 'stopped' -or -not $finished.endedMs){throw 'Clean finalization failed'}
 $events=Get-Content -LiteralPath (Join-Path $sessionRoot ($first.sessionId+'\app-events.jsonl')) | ForEach-Object {$_ | ConvertFrom-Json}
 if(-not ($events | Where-Object {$_.event.operation -eq 'application' -and $_.event.outcome -eq 'started'})){throw 'Startup event missing'}
 if(-not ($events | Where-Object {$_.event.operation -eq 'application' -and $_.event.outcome -eq 'shutdown'})){throw 'Shutdown event missing'}
 $before=@(Sessions | ForEach-Object {$_.sessionId})
 $app=Start-Process -FilePath $Executable -ArgumentList '--diagnostics','--diagnostic-session','runtime-interruption' -WindowStyle Hidden -PassThru
 $second=NewSession $before
 Start-Sleep -Milliseconds 700
 Stop-Process -Id $app.Id -Force
 $app.WaitForExit()
 $app=Start-Process -FilePath $Executable -WindowStyle Hidden -PassThru
 for($i=0;$i -lt 30;$i++){ $recovered=Sessions | Where-Object sessionId -eq $second.sessionId;if($recovered.state -eq 'interrupted'){break};Start-Sleep -Milliseconds 200 }
 if($recovered.state -ne 'interrupted'){throw 'Interrupted recovery failed'}
 if(@(Sessions | Where-Object state -eq 'active').Count -ne 0){throw 'Stale session resurrected'}
 StopClean $app
 [pscustomobject]@{status='PASS';cleanSession=$first.sessionId;interruptedSession=$second.sessionId;startupCaptured=$true;cleanShutdown=$true;manualRestartInactive=$true;signedIn=$false} | ConvertTo-Json
}finally{if($app -and -not $app.HasExited){Stop-Process -Id $app.Id -Force}}
