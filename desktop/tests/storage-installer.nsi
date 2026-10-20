Unicode true
SilentInstall silent
SilentUnInstall silent
RequestExecutionLevel user
Name "BlinkFlow isolated data-preservation check"
OutFile "..\..\.checks\storage-nsis-test.exe"
InstallDir "${__FILEDIR__}\..\..\.checks\storage-nsis-fixture"
!define UNINSTALL_FILENAME "Uninstall.exe"
!include "..\installer.nsh"
Section
  SetOutPath "$INSTDIR\BlinkFlowData\Profile"
  FileOpen $0 "$OUTDIR\must-remain.txt" w
  FileWrite $0 "API and canvas test data"
  FileClose $0
  SetOutPath "$INSTDIR\resources"
  FileOpen $0 "$OUTDIR\remove.txt" w
  FileWrite $0 "old resources"
  FileClose $0
  SetOutPath "$INSTDIR"
  FileOpen $0 "$OUTDIR\BlinkFlow.exe" w
  FileWrite $0 "old program"
  FileClose $0
  WriteUninstaller "$INSTDIR\${UNINSTALL_FILENAME}"
SectionEnd
Section "Uninstall"
  !insertmacro customRemoveFiles
SectionEnd
