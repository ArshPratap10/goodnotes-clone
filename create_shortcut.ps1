$appDir = "C:\Users\91969\Desktop\GoodNotes Clone\GoodNotes_App"
$electronExe = "$appDir\node_modules\electron\dist\electron.exe"
$iconPath = "$appDir\electron\icon.ico"
$shortcutPath = "C:\Users\91969\Desktop\GoodNotes App.lnk"

$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = $electronExe
$shortcut.Arguments = "`"$appDir`""
$shortcut.WorkingDirectory = $appDir
$shortcut.IconLocation = "$iconPath, 0"
$shortcut.Description = "GoodNotes Desktop App - Digital Note Taking"
$shortcut.Save()

Write-Host "Shortcut created on Desktop!"
Write-Host "Target: $electronExe"
