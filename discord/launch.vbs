Option Explicit
' ---------------------------------------------------------------
'  Messenger launcher (no console window).
'  Starts the local Node server and opens the app window (Edge/Chrome --app).
'  The server stops itself when the app window is closed.
' ---------------------------------------------------------------

Dim sh, fso, base, url, node, browser, profile
Set sh  = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")

base = fso.GetParentFolderName(WScript.ScriptFullName)
url = "http://localhost:3001/"

If Not fso.FileExists(base & "\server.js") Then
  MsgBox "server.js not found next to the launcher.", 16, "Messenger"
  WScript.Quit 1
End If

' --- find node.exe ---
node = FindFirst(Array( _
  sh.ExpandEnvironmentStrings("%ProgramFiles%") & "\nodejs\node.exe", _
  sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%") & "\nodejs\node.exe", _
  sh.ExpandEnvironmentStrings("%LOCALAPPDATA%") & "\Programs\nodejs\node.exe" ))

If node = "" Then
  Dim pathEnv, parts, i
  pathEnv = sh.ExpandEnvironmentStrings("%PATH%")
  parts = Split(pathEnv, ";")
  For i = 0 To UBound(parts)
    If Len(Trim(parts(i))) > 0 Then
      If fso.FileExists(Trim(parts(i)) & "\node.exe") Then
        node = Trim(parts(i)) & "\node.exe"
        Exit For
      End If
    End If
  Next
End If

If node = "" Then
  MsgBox "Node.js not found. Install Node.js LTS from nodejs.org and try again.", 16, "Messenger"
  WScript.Quit 1
End If

' --- start server hidden in app mode (a second instance will exit on its own) ---
sh.Run """" & node & """ """ & base & "\server.js"" --app", 0, False

' --- find a Chromium browser for the app window ---
Dim pf, pf86, local
pf    = sh.ExpandEnvironmentStrings("%ProgramFiles%")
pf86  = sh.ExpandEnvironmentStrings("%ProgramFiles(x86)%")
local = sh.ExpandEnvironmentStrings("%LOCALAPPDATA%")

browser = FindFirst(Array( _
  pf86 & "\Microsoft\Edge\Application\msedge.exe", _
  pf   & "\Microsoft\Edge\Application\msedge.exe", _
  pf   & "\Google\Chrome\Application\chrome.exe", _
  pf86 & "\Google\Chrome\Application\chrome.exe", _
  local & "\Google\Chrome\Application\chrome.exe" ))

profile = local & "\MessengerApp\profile"
If Not fso.FolderExists(profile) Then
  On Error Resume Next
  fso.CreateFolder local & "\MessengerApp"
  fso.CreateFolder profile
  On Error Goto 0
End If

' give the server a moment to come up
WScript.Sleep 1200

If browser <> "" Then
  ' розмір вікна під робочий стіл + максимізація, щоб застосунок був на весь екран
  Dim pw, scr, w, h, p1, p2
  Set pw = sh.Exec("powershell -NoProfile -WindowStyle Hidden -Command ""Add-Type -AssemblyName System.Windows.Forms; $b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds; $w=$b.Width; $h=$b.Height; if($w -lt 800){$v=Get-CimInstance Win32_VideoController|Select-Object -First 1;$w=$v.CurrentHorizontalResolution;$h=$v.CurrentVerticalResolution}; Write-Output ($w.ToString()+','+$h.ToString())""")
  w = "1280" : h = "820"
  On Error Resume Next
  While pw.Status = 0
    WScript.Sleep 40
  Wend
  scr = Trim(pw.StdOut.ReadAll())
  On Error Goto 0
  If InStr(scr, ",") > 0 Then
    p1 = Split(scr, ",")(0) : p2 = Split(scr, ",")(1)
    If IsNumeric(p1) And IsNumeric(p2) And CLng(p1) >= 800 And CLng(p2) >= 600 Then
      w = p1 : h = p2
    End If
  End If
  sh.Run """" & browser & """ --app=" & url & _
    " --window-size=" & w & "," & h & " --window-position=0,0 --start-maximized --no-first-run --no-default-browser-check" & _
    " --user-data-dir=""" & profile & """", 1, False
Else
  sh.Run url, 1, False
End If

Function FindFirst(arr)
  Dim k
  FindFirst = ""
  For k = 0 To UBound(arr)
    If fso.FileExists(arr(k)) Then
      FindFirst = arr(k)
      Exit Function
    End If
  Next
End Function
