; 仅注册可选打开入口，不写扩展名默认值或 Explorer UserChoice。
; TXT/Markdown/CSV 图标仅写入各自的 zNote ProgID，不修改其他应用图标。
!macro ZNOTE_ADD_OPEN_WITH EXT
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\SupportedTypes" ".${EXT}" ""
  WriteRegStr SHCTX "Software\Classes\.${EXT}\OpenWithList\${MAINBINARYNAME}.exe" "" ""
!macroend

!macro ZNOTE_REMOVE_OPEN_WITH EXT
  DeleteRegKey SHCTX "Software\Classes\.${EXT}\OpenWithList\${MAINBINARYNAME}.exe"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}\OpenWithList"
  DeleteRegKey /ifempty SHCTX "Software\Classes\.${EXT}"
!macroend

; 旧版多次安装可能把自身 ProgID 写入 backup；此时删除用户层默认值，回退系统关联。
; 只恢复仍指向旧版自动关联的值，绝不覆盖其他应用或用户后来选择的默认值。
!macro ZNOTE_RESTORE_LEGACY EXT
  ReadRegStr $R0 SHCTX "Software\Classes\.${EXT}" ""
  ${If} $R0 == "zNote 文本文件"
    ReadRegStr $R1 SHCTX "Software\Classes\.${EXT}" "zNote 文本文件_backup"
    ${If} $R1 == ""
    ${OrIf} $R1 == "zNote 文本文件"
      DeleteRegValue SHCTX "Software\Classes\.${EXT}" ""
    ${Else}
      WriteRegStr SHCTX "Software\Classes\.${EXT}" "" "$R1"
    ${EndIf}
  ${EndIf}
  DeleteRegValue SHCTX "Software\Classes\.${EXT}" "zNote 文本文件_backup"
!macroend

!include "${__FILEDIR__}\text-extensions.nsh"
!include "${__FILEDIR__}\file-icons.nsh"

!macro NSIS_HOOK_POSTINSTALL
  !insertmacro ZNOTE_LEGACY_EXTENSIONS ZNOTE_RESTORE_LEGACY
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe" "FriendlyAppName" "zNote"
  WriteRegStr SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe\shell\open\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  !insertmacro ZNOTE_TEXT_EXTENSIONS ZNOTE_ADD_OPEN_WITH
  !insertmacro ZNOTE_REGISTER_FILE_ICONS
  ; 任意扩展名和 Dockerfile 等无扩展名文件也有显式入口，不更改双击行为。
  WriteRegStr SHCTX "Software\Classes\*\shell\zNote.OpenAsText" "" "使用 zNote 打开"
  WriteRegStr SHCTX "Software\Classes\*\shell\zNote.OpenAsText\command" "" '$\"$INSTDIR\${MAINBINARYNAME}.exe$\" $\"%1$\"'
  !insertmacro UPDATEFILEASSOC
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  !insertmacro ZNOTE_UNREGISTER_FILE_ICONS
  !insertmacro ZNOTE_TEXT_EXTENSIONS ZNOTE_REMOVE_OPEN_WITH
  DeleteRegKey SHCTX "Software\Classes\Applications\${MAINBINARYNAME}.exe"
  DeleteRegKey SHCTX "Software\Classes\*\shell\zNote.OpenAsText"
  !insertmacro UPDATEFILEASSOC
!macroend
