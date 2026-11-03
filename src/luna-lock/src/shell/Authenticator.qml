pragma ComponentBehavior: Bound

import QtQuick
import Quickshell.Services.Pam

// PAM owns the conversation and its responses. Only a successful conversation
// started for the current secure session can ask the controller to unlock.
PamContext {
    id: authentication

    config: "login"
    property bool secure: false
    property bool conversationPending: false
    property string statusText: ""
    readonly property bool busy: active && !responseRequired
    readonly property bool canRetry: secure && !active && !conversationPending
    signal authenticated()
    signal clearInput()

    function begin() {
        if (!secure || active || conversationPending)
            return;
        conversationPending = true;
        if (!start()) {
            conversationPending = false;
            statusText = "Authentication unavailable";
        }
    }

    function submit(response) {
        if (secure && conversationPending && responseRequired) {
            statusText = "";
            respond(response);
        }
    }

    onSecureChanged: {
        clearInput();
        if (secure) {
            begin();
        } else {
            conversationPending = false;
            abort();
            statusText = "";
        }
    }
    onPamMessage: {
        if (messageIsError)
            statusText = message;
    }
    onError: {
        conversationPending = false;
        clearInput();
        statusText = "Authentication unavailable";
    }
    onCompleted: result => {
        const currentConversation = conversationPending && secure;
        conversationPending = false;
        clearInput();
        if (!currentConversation)
            return;
        if (result === PamResult.Success) {
            authenticated();
        } else {
            statusText = result === PamResult.Failed || result === PamResult.MaxTries
                ? "Try again" : "Authentication unavailable";
            if (result === PamResult.Failed || result === PamResult.MaxTries)
                Qt.callLater(begin);
        }
    }
}
