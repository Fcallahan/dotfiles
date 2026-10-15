#Requires AutoHotkey v2.0
#SingleInstance Off

if A_Args.Length > 0 && A_Args[1] = "--validate"
    ExitApp(0)

if A_Args.Length != 1
    ExitApp(64)

reminderId := A_Args[1]
if !RegExMatch(reminderId, "^[A-Za-z0-9-]+$")
    ExitApp(65)

pendingFile := A_ScriptDir "\reminders\pending\" reminderId ".txt"
taskName := "TaskCapture-Reminder-" reminderId

try {
    reminderText := Trim(FileRead(pendingFile, "UTF-8"))
    if reminderText = ""
        throw Error("The reminder text is blank.")

    TrayTip(reminderText, "Reminder", 1)
    try SoundBeep(880, 180)
    Sleep(15000)
} catch as err {
    TrayTip("Reminder could not be displayed.`n" err.Message, "Task Capture", 3)
    Sleep(8000)
} finally {
    schtasksExe := A_WinDir "\System32\schtasks.exe"
    try RunWait(schtasksExe " /Delete /TN " taskName " /F", , "Hide")
    try FileDelete(pendingFile)
}

ExitApp(0)
