' Run RustBot in a hidden window (no console). Used by Task Scheduler autostart.
Set fso = CreateObject("Scripting.FileSystemObject")
dir = fso.GetParentFolderName(WScript.ScriptFullName)
Set ws = CreateObject("WScript.Shell")
ws.Run "cmd /c cd /d """ & dir & """ && node src\index.js", 0, False