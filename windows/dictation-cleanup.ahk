#Requires AutoHotkey v2.0
#SingleInstance Force

; User-editable settings
HotkeyCombo := "^!h" ; Ctrl+Alt+H
WslDistro := ""      ; Empty means default WSL distro
WslScript := "~/dotfiles/dictation/cleanup-dictation"
DefaultMode := "light"
PopupWidth := 720
PopupHeight := 420

Hotkey HotkeyCombo, ShowDictationPopup

ShowDictationPopup(*) {
    global WslDistro, WslScript, DefaultMode, PopupWidth, PopupHeight

    previousWindow := WinExist("A")
    oldClipboard := ClipboardAll()

    dictGui := Gui("+AlwaysOnTop +Resize", "Dictation Cleanup")
    dictGui.SetFont("s10", "Segoe UI")
    dictGui.MarginX := 12
    dictGui.MarginY := 12

    dictGui.AddText("xm ym", "Dictate or type text below. Use Windows Voice Typing inside this box, then press Ctrl+Enter.")
    modeChoice := dictGui.AddDropDownList("xm y+8 w180", ["Light cleanup", "Polish"])
    modeChoice.Choose(DefaultMode = "polish" ? 2 : 1)

    edit := dictGui.AddEdit("xm y+8 w" . (PopupWidth - 24) . " h" . (PopupHeight - 145) . " WantTab -Wrap")
    status := dictGui.AddText("xm y+8 w" . (PopupWidth - 150), "Ready")
    cleanButton := dictGui.AddButton("x+8 yp-4 w110 Default", "Clean + Paste")

    cleanButton.OnEvent("Click", (*) => SubmitDictation(dictGui, edit, modeChoice, status, previousWindow, oldClipboard, WslDistro, WslScript))
    dictGui.OnEvent("Escape", (*) => dictGui.Destroy())
    dictGui.OnEvent("Close", (*) => dictGui.Destroy())
    dictGui.OnEvent("Size", (*) => ResizePopup(dictGui, edit, status, cleanButton))

    HotIfWinActive "Dictation Cleanup"
    Hotkey "^Enter", (*) => SubmitDictation(dictGui, edit, modeChoice, status, previousWindow, oldClipboard, WslDistro, WslScript), "On"
    HotIfWinActive

    dictGui.Show("w" . PopupWidth . " h" . PopupHeight)
    edit.Focus()
}

ResizePopup(dictGui, edit, status, cleanButton) {
    try {
        dictGui.GetClientPos(,, &width, &height)
        edit.Move(,, width - 24, height - 145)
        status.Move(, height - 40, width - 150)
        cleanButton.Move(width - 122, height - 44)
    }
}

SubmitDictation(dictGui, edit, modeChoice, status, previousWindow, oldClipboard, WslDistro, WslScript) {
    text := edit.Value
    if Trim(text) = "" {
        status.Text := "Enter or dictate text before submitting."
        return
    }

    selectedMode := modeChoice.Text = "Polish" ? "polish" : "light"
    status.Text := "Cleaning with WSL/pi..."

    try {
        cleaned := RunWslCleanup(text, selectedMode, WslDistro, WslScript)
    } catch as err {
        status.Text := "Error: " . err.Message
        return
    }

    if Trim(cleaned) = "" {
        status.Text := "Cleanup returned empty text. Popup left open."
        return
    }

    A_Clipboard := cleaned
    if !ClipWait(2) {
        status.Text := "Failed to place cleaned text on clipboard."
        return
    }

    if previousWindow {
        WinActivate "ahk_id " . previousWindow
        WinWaitActive "ahk_id " . previousWindow,, 2
        Sleep 100
        Send "^v"
        Sleep 250
        try A_Clipboard := oldClipboard
    }

    dictGui.Destroy()
}

RunWslCleanup(text, mode, WslDistro, WslScript) {
    tempIn := A_Temp . "\\dictation-cleanup-in-" . A_TickCount . ".txt"
    tempOut := A_Temp . "\\dictation-cleanup-out-" . A_TickCount . ".txt"
    tempErr := A_Temp . "\\dictation-cleanup-err-" . A_TickCount . ".txt"

    FileAppend text, tempIn, "UTF-8"

    distroPart := WslDistro = "" ? "" : "-d " . QuoteForCmd(WslDistro) . " "
    bashCommand := QuoteForBash(WslScript) . " --mode " . QuoteForBash(mode) . " < " . QuoteForBash(WindowsPathToWsl(tempIn))
    command := A_ComSpec . " /C wsl.exe " . distroPart . "bash -lc " . QuoteForCmd(bashCommand) . " > " . QuoteForCmd(tempOut) . " 2> " . QuoteForCmd(tempErr)

    exitCode := RunWait(command,, "Hide")
    output := FileExist(tempOut) ? FileRead(tempOut, "UTF-8") : ""
    errorOutput := FileExist(tempErr) ? FileRead(tempErr, "UTF-8") : ""

    TryDelete(tempIn)
    TryDelete(tempOut)
    TryDelete(tempErr)

    if exitCode != 0 {
        message := Trim(errorOutput) != "" ? Trim(errorOutput) : "wsl.exe exited with code " . exitCode
        throw Error(message)
    }

    return Trim(output, " `t`r`n")
}

WindowsPathToWsl(path) {
    drive := SubStr(path, 1, 1)
    rest := SubStr(path, 3)
    rest := StrReplace(rest, "\\", "/")
    return "/mnt/" . StrLower(drive) . rest
}

QuoteForCmd(value) {
    return '"' . StrReplace(value, '"', '\"') . '"'
}

QuoteForBash(value) {
    if SubStr(value, 1, 2) = "~/" {
        rest := SubStr(value, 3)
        return "~/" . "'" . StrReplace(rest, "'", "'\''") . "'"
    }
    return "'" . StrReplace(value, "'", "'\''") . "'"
}

TryDelete(path) {
    try {
        if FileExist(path) {
            FileDelete path
        }
    }
}
