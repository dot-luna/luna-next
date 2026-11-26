import Luna.UI 1.0 as UI

UI.InputDialog {
    id: dialog
    required property MockState mockState
    objectName: "themeRepositoryDialog"
    title: "Add Theme"
    fieldLabel: "Repository URL"
    placeholderText: "https://github.com/user/theme"
    onSubmitted: value => {
        errorMessage = mockState.addTheme(value);
        if (!errorMessage) close();
    }
}
