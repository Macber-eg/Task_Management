# Add Git to PATH for this terminal session (Git installed on C:, project on D:)
$gitCmd = "C:\Program Files\Git\cmd"
$gitBin = "C:\Program Files\Git\bin"
if (Test-Path $gitCmd) {
  $env:Path = "$gitCmd;$gitBin;" + $env:Path
  Write-Host "Git ready: $(git --version)"
} else {
  Write-Error "Git not found at C:\Program Files\Git. Install from https://git-scm.com/download/win"
}
