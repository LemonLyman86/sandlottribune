$appnpm = Join-Path $env:APPDATA 'npm'

# Persist AppData\npm to user PATH if missing
$userPath = [Environment]::GetEnvironmentVariable('Path','User')
if(-not ($userPath -like "*$appnpm*")) {
    [Environment]::SetEnvironmentVariable('Path', "$appnpm;" + $userPath, 'User')
    Write-Output "Persisted $appnpm to User PATH"
} else {
    Write-Output "$appnpm already in User PATH"
}

# Set PowerShell execution policy for current user so npm scripts can run
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned -Force
Write-Output 'Execution policy set to RemoteSigned for CurrentUser'

# Run version checks in a fresh PowerShell process
Start-Process powershell -ArgumentList '-NoProfile','-Command','& "C:\\Program Files\\nodejs\\node.exe" -v; & "C:\\Program Files\\nodejs\\npm.cmd" -v; & "$env:APPDATA\\npm\\firebase.cmd" --version' -Wait -NoNewWindow
Write-Output 'Done'
