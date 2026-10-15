#Requires AutoHotkey v2.0
#SingleInstance Force

global taskGui := 0
global taskEdit := 0
global taskNowRadio := 0
global taskLaterRadio := 0
global taskWayLaterRadio := 0
global taskKindList := 0
global taskValidation := 0

if A_Args.Length > 0 && A_Args[1] = "--validate"
    ExitApp(0)

#+t::CaptureTask()
#+d::OpenTaskInbox()
#+i::OpenTaskInbox()
#+r::CreateReminder()
^+h::ShowDictationCleanup()

CaptureTask() {
    global taskGui, taskEdit, taskNowRadio, taskLaterRadio, taskWayLaterRadio, taskKindList, taskValidation

    if IsObject(taskGui) {
        try {
            taskGui.Show()
            WinActivate("ahk_id " taskGui.Hwnd)
            taskEdit.Focus()
            return
        }
        catch {
            taskGui := 0
        }
    }

    taskGui := Gui("+AlwaysOnTop", "Quick Task")
    taskGui.MarginX := 12
    taskGui.MarginY := 10
    taskGui.OnEvent("Close", CloseTaskGui)
    taskGui.OnEvent("Escape", CloseTaskGui)

    taskGui.AddText("xm", "Task")
    taskEdit := taskGui.AddEdit("xm w420 vTaskText")

    taskGui.AddText("xm y+10", "When")
    taskNowRadio := taskGui.AddRadio("xm y+5 vTaskUrgency", "Do Now")
    taskLaterRadio := taskGui.AddRadio("x+16 yp", "Do Later")
    taskWayLaterRadio := taskGui.AddRadio("x+16 yp", "Do Way Later")
    taskLaterRadio.Value := 1

    taskGui.AddText("xm y+10", "Kind")
    taskKindList := taskGui.AddDropDownList("xm w420 Choose1 vTaskKind", [
        "Select task kind...",
        "Code/Fix",
        "Review",
        "Investigate",
        "Ops/Check",
        "Communicate",
        "Personal"
    ])

    taskValidation := taskGui.AddText("xm w420 cRed y+8", "")
    addButton := taskGui.AddButton("xm w90 Default", "Add")
    addButton.OnEvent("Click", AddObsidianTask)
    cancelButton := taskGui.AddButton("x+10 w90", "Cancel")
    cancelButton.OnEvent("Click", CloseTaskGui)

    taskGui.Show()
    taskEdit.Focus()
}

AddObsidianTask(*) {
    global taskGui, taskEdit, taskNowRadio, taskLaterRadio, taskWayLaterRadio, taskKindList, taskValidation

    description := NormalizeTaskText(taskEdit.Value)
    if description = "" {
        taskValidation.Text := "Enter a task description."
        taskEdit.Focus()
        return
    }

    kindMap := Map(
        "Code/Fix", "code-fix",
        "Review", "review",
        "Investigate", "investigate",
        "Ops/Check", "ops-check",
        "Communicate", "communicate",
        "Personal", "personal"
    )
    kindLabel := taskKindList.Text
    if !kindMap.Has(kindLabel) {
        taskValidation.Text := "Select a task kind."
        taskKindList.Focus()
        return
    }

    if taskNowRadio.Value {
        urgency := "now"
        urgencyLabel := "Do Now"
    }
    else if taskLaterRadio.Value {
        urgency := "later"
        urgencyLabel := "Do Later"
    }
    else {
        urgency := "way-later"
        urgencyLabel := "Do Way Later"
    }

    taskValidation.Text := ""
    requestFile := ""
    try {
        requestsDir := A_ScriptDir "\requests"
        DirCreate(requestsDir)
        requestFile := requestsDir "\" MakeSafeId() ".txt"

        file := FileOpen(requestFile, "w", "UTF-8-RAW")
        if !IsObject(file)
            throw Error("Could not create the task request.")
        file.Write(description)
        file.Close()

        powershellExe := A_WinDir "\System32\WindowsPowerShell\v1.0\powershell.exe"
        addScript := A_ScriptDir "\Add-ObsidianTask.ps1"
        command := '"' powershellExe '" -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "' addScript '" -RequestFile "' requestFile '" -Urgency ' urgency ' -Kind ' kindMap[kindLabel]
        exitCode := RunWait(command, , "Hide")

        if exitCode != 0
            throw Error("Could not add the task (exit code " exitCode ").")

        CloseTaskGui()
        TrayTip("Task added: " urgencyLabel " / " kindLabel, "Task Capture", 1)
    }
    catch as err {
        taskValidation.Text := "Could not add task. Try again."
        taskEdit.Focus()
    }
    finally {
        if requestFile != ""
            try FileDelete(requestFile)
    }
}

NormalizeTaskText(text) {
    return Trim(RegExReplace(text, "[\r\n]+", " "))
}

CloseTaskGui(*) {
    global taskGui, taskEdit, taskNowRadio, taskLaterRadio, taskWayLaterRadio, taskKindList, taskValidation

    if IsObject(taskGui) {
        try taskGui.Destroy()
    }

    taskGui := 0
    taskEdit := 0
    taskNowRadio := 0
    taskLaterRadio := 0
    taskWayLaterRadio := 0
    taskKindList := 0
    taskValidation := 0
}

OpenTaskInbox() {
    try Run("obsidian://open?vault=Task_Inbox_Vault&file=Task%20Inbox.md")
    catch as err
        TrayTip("Could not open Task Inbox.`n" err.Message, "Task Capture", 3)
}

CreateReminder() {
    minutesResult := InputBox("Remind me in minutes:", "Quick Reminder", "w360 h130")
    if minutesResult.Result != "OK"
        return

    minutesText := Trim(minutesResult.Value)
    if !RegExMatch(minutesText, "^\d+$") {
        TrayTip("Enter a whole number of minutes.", "Quick Reminder", 2)
        return
    }

    minutes := minutesText + 0
    if minutes < 1 || minutes > 525600 {
        TrayTip("Minutes must be between 1 and 525600.", "Quick Reminder", 2)
        return
    }

    reminderResult := InputBox("Reminder:", "Quick Reminder", "w440 h135")
    if reminderResult.Result != "OK"
        return

    reminderText := Trim(reminderResult.Value)
    if reminderText = ""
        return

    reminderId := MakeSafeId()
    pendingDir := A_ScriptDir "\reminders\pending"
    DirCreate(pendingDir)
    reminderFile := pendingDir "\" reminderId ".txt"

    try {
        file := FileOpen(reminderFile, "w", "UTF-8-RAW")
        if !IsObject(file)
            throw Error("Could not create the reminder request.")
        file.Write(reminderText)
        file.Close()

        powershellExe := A_WinDir "\System32\WindowsPowerShell\v1.0\powershell.exe"
        scheduleScript := A_ScriptDir "\Schedule-Reminder.ps1"
        command := powershellExe " -NoProfile -NonInteractive -ExecutionPolicy Bypass -File " scheduleScript " -Minutes " minutes " -ReminderId " reminderId
        exitCode := RunWait(command, , "Hide")

        if exitCode != 0
            throw Error("Windows Task Scheduler returned exit code " exitCode ".")

        TrayTip("Reminder set for " minutes " minute(s): " reminderText, "Quick Reminder", 1)
    } catch as err {
        try FileDelete(reminderFile)
        TrayTip("Reminder was not scheduled.`n" err.Message, "Quick Reminder", 3)
    }
}

MakeSafeId() {
    return FormatTime(, "yyyyMMddHHmmss") "-" A_TickCount "-" Random(100000, 999999)
}

ShowDictationCleanup(*) {
    dctPreviousWindow := WinExist("A")
    dctDefaultMode := "polish"
    dctPopupWidth := 720
    dctPopupHeight := 420

    dctGui := Gui("+AlwaysOnTop +Resize", "Dictation Cleanup")
    dctGui.SetFont("s10", "Segoe UI")
    dctGui.MarginX := 12
    dctGui.MarginY := 12

    dctGui.AddText("xm ym", "Dictate or type text below. Use Windows Voice Typing inside this box, then press Ctrl+Enter.")
    dctModeChoice := dctGui.AddDropDownList("xm y+8 w180", ["Light cleanup", "Polish"])
    dctModeChoice.Choose(dctDefaultMode = "polish" ? 2 : 1)

    dctEdit := dctGui.AddEdit("xm y+8 w" . (dctPopupWidth - 24) . " h" . (dctPopupHeight - 145) . " WantTab -Wrap")
    dctStatus := dctGui.AddText("xm y+8 w" . (dctPopupWidth - 150), "Ready")
    dctCleanButton := dctGui.AddButton("x+8 yp-4 w110 Default", "Clean + Paste")

    dctCleanButton.OnEvent("Click", (*) => DctSubmit(dctGui, dctEdit, dctModeChoice, dctStatus, dctPreviousWindow))
    dctGui.OnEvent("Escape", (*) => dctGui.Destroy())
    dctGui.OnEvent("Close", (*) => dctGui.Destroy())
    dctGui.OnEvent("Size", (*) => DctResizePopup(dctGui, dctEdit, dctStatus, dctCleanButton))

    HotIfWinActive "Dictation Cleanup"
    Hotkey "^Enter", (*) => DctSubmit(dctGui, dctEdit, dctModeChoice, dctStatus, dctPreviousWindow), "On"
    HotIfWinActive

    dctGui.Show("w" . dctPopupWidth . " h" . dctPopupHeight)
    dctEdit.Focus()
}

DctResizePopup(dctGui, dctEdit, dctStatus, dctCleanButton) {
    try {
        dctGui.GetClientPos(,, &dctWidth, &dctHeight)
        dctEdit.Move(,, dctWidth - 24, dctHeight - 145)
        dctStatus.Move(, dctHeight - 40, dctWidth - 150)
        dctCleanButton.Move(dctWidth - 122, dctHeight - 44)
    }
}

DctSubmit(dctGui, dctEdit, dctModeChoice, dctStatus, dctPreviousWindow) {
    dctText := dctEdit.Value
    if Trim(dctText) = "" {
        dctStatus.Text := "Enter or dictate text before submitting."
        return
    }

    dctSelectedMode := dctModeChoice.Text = "Polish" ? "polish" : "light"
    dctStatus.Text := "Cleaning with WSL/pi..."

    try {
        dctCleaned := DctRunWslCleanup(dctText, dctSelectedMode)
    } catch as err {
        dctStatus.Text := "Error: " . err.Message
        return
    }

    if Trim(dctCleaned) = "" {
        dctStatus.Text := "Cleanup returned empty text. Popup left open."
        return
    }

    ; The cleaned text stays on the clipboard. It is also pasted when a real
    ; window (not the desktop or taskbar) was focused before the popup opened.
    A_Clipboard := ""
    A_Clipboard := dctCleaned
    if !ClipWait(2) {
        dctStatus.Text := "Failed to place cleaned text on clipboard."
        return
    }

    dctGui.Destroy()
    if DctIsPasteTarget(dctPreviousWindow) {
        WinActivate "ahk_id " . dctPreviousWindow
        WinWaitActive "ahk_id " . dctPreviousWindow,, 2
        Sleep 100
        Send "^v"
    }
}

DctIsPasteTarget(dctWindow) {
    if !dctWindow || !WinExist("ahk_id " . dctWindow)
        return false
    return !(WinGetClass("ahk_id " . dctWindow) ~= "^(Progman|WorkerW|Shell_TrayWnd|Shell_SecondaryTrayWnd)$")
}

DctRunWslCleanup(dctText, dctMode) {
    dctTempIn := A_Temp . "\\dictation-cleanup-in-" . A_TickCount . ".txt"
    dctTempOut := A_Temp . "\\dictation-cleanup-out-" . A_TickCount . ".txt"
    dctTempErr := A_Temp . "\\dictation-cleanup-err-" . A_TickCount . ".txt"

    FileAppend dctText, dctTempIn, "UTF-8-RAW"

    dctBashCommand := DctQuoteForBash("~/dotfiles/dictation/cleanup-dictation") . " --mode " . DctQuoteForBash(dctMode) . " < " . DctQuoteForBash(DctWindowsPathToWsl(dctTempIn))
    dctCommand := A_ComSpec . " /C wsl.exe bash -lc " . DctQuoteForCmd(dctBashCommand) . " > " . DctQuoteForCmd(dctTempOut) . " 2> " . DctQuoteForCmd(dctTempErr)

    dctExitCode := RunWait(dctCommand,, "Hide")
    dctOutput := FileExist(dctTempOut) ? FileRead(dctTempOut, "UTF-8") : ""
    dctErrorOutput := FileExist(dctTempErr) ? FileRead(dctTempErr, "UTF-8") : ""

    DctTryDelete(dctTempIn)
    DctTryDelete(dctTempOut)
    DctTryDelete(dctTempErr)

    if dctExitCode != 0 {
        dctMessage := Trim(dctErrorOutput) != "" ? Trim(dctErrorOutput) : "wsl.exe exited with code " . dctExitCode
        throw Error(dctMessage)
    }

    return Trim(dctOutput, " `t`r`n")
}

DctWindowsPathToWsl(dctPath) {
    dctDrive := SubStr(dctPath, 1, 1)
    dctRest := SubStr(dctPath, 3)
    dctRest := StrReplace(dctRest, "\", "/")
    return "/mnt/" . StrLower(dctDrive) . dctRest
}

DctQuoteForCmd(dctValue) {
    return '"' . StrReplace(dctValue, '"', '\"') . '"'
}

DctQuoteForBash(dctValue) {
    if SubStr(dctValue, 1, 2) = "~/" {
        dctRest := SubStr(dctValue, 3)
        return "~/" . "'" . StrReplace(dctRest, "'", "'\''") . "'"
    }
    return "'" . StrReplace(dctValue, "'", "'\''") . "'"
}

DctTryDelete(dctPath) {
    try {
        if FileExist(dctPath)
            FileDelete dctPath
    }
}
