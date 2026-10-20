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
      RMDir /r "$INSTDIR\$R1"
      Goto blinkflow_remove_check
    blinkflow_remove_file:
      Delete "$INSTDIR\$R1"
      ; The running uninstaller itself is released by NSIS after exit.
      StrCmp $R1 "${UNINSTALL_FILENAME}" 0 +2
      ClearErrors
    blinkflow_remove_check:
      IfErrors 0 blinkflow_remove_skip
      FindClose $R0
      Abort "程序文件正在使用，请关闭 BlinkFlow 后重试。BlinkFlowData 未删除。"
    blinkflow_remove_skip:
      FindNext $R0 $R1
      Goto blinkflow_remove_next
  blinkflow_remove_done:
  FindClose $R0
  RMDir "$INSTDIR"
!macroend
