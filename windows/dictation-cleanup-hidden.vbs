' Hidden launcher for dictation-cleanup.ps1.
' Use this as the Windows shortcut target to avoid showing a PowerShell console.

Set shell = CreateObject("Wscript.Shell")
scriptPath = Replace(WScript.ScriptFullName, "dictation-cleanup-hidden.vbs", "dictation-cleanup.ps1")
command = "powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File """ & scriptPath & """"
shell.Run command, 0, False
