; 独立 ProgID 仅作为候选。由 Windows 默认应用界面选择，不写 UserChoice。
!macro ZNOTE_REGISTER_FILE_TYPE PROGID DESCRIPTION ICON
  WriteRegStr SHCTX "Software\Classes\${PROGID}" "" "${DESCRIPTION}"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\DefaultIcon" "" '$\"$INSTDIR\icons\file-types\${ICON}.ico$\",0'
  WriteRegStr SHCTX "Software\Classes\${PROGID}\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "ApplicationName" "zNote"
  WriteRegStr SHCTX "Software\Classes\${PROGID}\Application" "ApplicationDescription" "个人文本与 Markdown 编辑器"
!macroend

!macro ZNOTE_REGISTER_FILE_ICONS
  !insertmacro ZNOTE_REGISTER_FILE_TYPE "zNote.Text" "zNote 文本文档" "text"
  !insertmacro ZNOTE_REGISTER_FILE_TYPE "zNote.Markdown" "zNote Markdown 文档" "markdown"
  !insertmacro ZNOTE_REGISTER_FILE_TYPE "zNote.CSV" "zNote CSV 表格" "csv"
  WriteRegStr SHCTX "Software\Classes\.txt\OpenWithProgids" "zNote.Text" ""
  WriteRegStr SHCTX "Software\Classes\.md\OpenWithProgids" "zNote.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\.markdown\OpenWithProgids" "zNote.Markdown" ""
  WriteRegStr SHCTX "Software\Classes\.csv\OpenWithProgids" "zNote.CSV" ""
  WriteRegStr SHCTX "Software\zNote\Capabilities" "ApplicationName" "zNote"
  WriteRegStr SHCTX "Software\zNote\Capabilities" "ApplicationDescription" "个人文本与 Markdown 编辑器"
  WriteRegStr SHCTX "Software\zNote\Capabilities" "ApplicationIcon" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\",0'
  WriteRegStr SHCTX "Software\zNote\Capabilities\FileAssociations" ".txt" "zNote.Text"
  WriteRegStr SHCTX "Software\zNote\Capabilities\FileAssociations" ".md" "zNote.Markdown"
  WriteRegStr SHCTX "Software\zNote\Capabilities\FileAssociations" ".markdown" "zNote.Markdown"
  WriteRegStr SHCTX "Software\zNote\Capabilities\FileAssociations" ".csv" "zNote.CSV"
  WriteRegStr SHCTX "Software\RegisteredApplications" "zNote" "Software\zNote\Capabilities"
!macroend

!macro ZNOTE_REMOVE_FILE_ICON_CANDIDATE EXT PROGID
  DeleteRegValue SHCTX "Software\Classes\.${EXT}\OpenWithProgids" "${PROGID}"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithProgids"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
!macroend

!macro ZNOTE_UNREGISTER_FILE_ICONS
  !insertmacro ZNOTE_REMOVE_FILE_ICON_CANDIDATE "txt" "zNote.Text"
  !insertmacro ZNOTE_REMOVE_FILE_ICON_CANDIDATE "md" "zNote.Markdown"
  !insertmacro ZNOTE_REMOVE_FILE_ICON_CANDIDATE "markdown" "zNote.Markdown"
  !insertmacro ZNOTE_REMOVE_FILE_ICON_CANDIDATE "csv" "zNote.CSV"
  DeleteRegKey SHCTX "Software\Classes\zNote.Text"
  DeleteRegKey SHCTX "Software\Classes\zNote.Markdown"
  DeleteRegKey SHCTX "Software\Classes\zNote.CSV"
  DeleteRegKey SHCTX "Software\zNote\Capabilities"
  DeleteRegKey /ifempty SHCTX "Software\zNote"
  DeleteRegValue SHCTX "Software\RegisteredApplications" "zNote"
!macroend
