; Use modern standalone 7-Zip: the Nsis7z + CopyFiles route silently drops
; Harness filenames beyond MAX_PATH. Only payload extraction is replaced.
!macro blinkflowExtractPayload FILE
  ClearErrors
  File /oname=$PLUGINSDIR\blinkflow-7za.exe "${BLINKFLOW_7ZIP_PATH}"
  IfErrors blinkflow_extract_failed
  nsExec::ExecToLog '"$PLUGINSDIR\blinkflow-7za.exe" x -y -aoa -bd -bb0 -bso0 -bsp0 -bse1 "-o$INSTDIR" "${FILE}"'
  Pop $R0
  StrCmp $R0 "0" blinkflow_extract_done
  blinkflow_extract_failed:
    MessageBox MB_OK|MB_ICONSTOP "程序文件解压失败。请检查安装目录的空间、权限或文件占用；BlinkFlowData 未删除。" /SD IDOK
    SetErrorLevel 2
    Quit
  blinkflow_extract_done:
!macroend

; App data lives beside BlinkFlow.exe; the default recursive removal of $INSTDIR
; would otherwise erase it during an overwrite installation or uninstall.
!macro customRemoveFiles
  SetOutPath $TEMP
  FindFirst $R0 $R1 "$INSTDIR\*"
  blinkflow_remove_next:
    StrCmp $R1 "" blinkflow_remove_done
    StrCmp $R1 "." blinkflow_remove_skip
    StrCmp $R1 ".." blinkflow_remove_skip
    StrCmp $R1 "BlinkFlowData" blinkflow_remove_skip
    ClearErrors
    IfFileExists "$INSTDIR\$R1\*.*" 0 blinkflow_remove_file
      ; Harness dependencies can exceed MAX_PATH in a user-selected install folder.
      RMDir /r "\\?\$INSTDIR\$R1"
      Goto blinkflow_remove_check
    blinkflow_remove_file:
      Delete "$INSTDIR\$R1"
      ; The running uninstaller itself is released by NSIS after exit.
      StrCmp $R1 "${UNINSTALL_FILENAME}" 0 +2
      ClearErrors
    blinkflow_remove_check:
      IfErrors 0 blinkflow_remove_skip
      FindClose $R0
      Abort "程序文件清理失败：$INSTDIR\$R1。请检查文件占用、路径或权限。BlinkFlowData 未删除。"
    blinkflow_remove_skip:
      FindNext $R0 $R1
      Goto blinkflow_remove_next
  blinkflow_remove_done:
  FindClose $R0
  RMDir "$INSTDIR"
!macroend
