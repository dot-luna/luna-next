#include <QApplication>
#include <QFile>
#include <QJsonDocument>
#include <QJsonObject>
#include <QSettings>
#include <QTextStream>
#include <QTimer>
#include <QWebEnginePage>
#include <QWebEngineProfile>

// Read the same native settings location as Whatly; all XDG roots belong to the fixture.
int main(int argc, char **argv) {
  QApplication app(argc, argv);
  QCoreApplication::setOrganizationName("shakaran");
  QCoreApplication::setApplicationName("whatly");
  QSettings settings(QSettings::NativeFormat, QSettings::UserScope,
                     "shakaran", "whatly");
  QFile css(QString::fromLocal8Bit(argv[1]));
  if (!css.open(QIODevice::ReadOnly)) return 1;
  const QString stylesheet = QString::fromUtf8(css.readAll());
  QWebEngineProfile profile;
  QWebEnginePage page(&profile);
  QTimer::singleShot(15000, &app, [&app] { app.exit(2); });
  QObject::connect(&page, &QWebEnginePage::loadFinished, &app, [&](bool ok) {
    if (!ok) { app.exit(3); return; }
    page.runJavaScript(R"JS(
      JSON.stringify({
        incoming: getComputedStyle(document.querySelector('.incoming')).backgroundColor,
        outgoing: getComputedStyle(document.querySelector('.outgoing')).backgroundColor,
        fade: getComputedStyle(document.querySelector('.fade')).backgroundColor,
        bubbleRadius: getComputedStyle(document.querySelector('.outgoing')).borderTopLeftRadius,
        buttonRadius: getComputedStyle(document.querySelector('button')).borderTopLeftRadius,
        avatarRadius: getComputedStyle(document.querySelector('.avatar')).borderTopLeftRadius,
        codeFont: getComputedStyle(document.querySelector('code span')).fontFamily
      })
    )JS", [&](const QVariant &value) {
      QJsonObject result = QJsonDocument::fromJson(value.toString().toUtf8()).object();
      for (const QString &key : {"useragent", "webFontFamily", "windowTheme"})
        result[key] = settings.value(key).toString();
      result["useragentType"] = settings.value("useragent").typeName();
      result["customCssEnabled"] = settings.value("customCssEnabled").toBool();
      QTextStream(stdout) << QJsonDocument(result).toJson(QJsonDocument::Compact) << Qt::endl;
      app.quit();
    });
  });
  // Exercise WhatsApp's semantic tokens, RGB gradients, logical bubble corners,
  // and Whatly's higher-specificity font rule loaded after the custom stylesheet.
  page.setHtml(QStringLiteral(R"HTML(
    <!doctype html><style>
      .incoming { background: var(--WDS-systems-bubble-surface-incoming); }
      .outgoing { background: var(--WDS-systems-bubble-surface-outgoing);
        border-start-start-radius: var(--chat-bubble-border-radius, 18px); }
      .fade { background: rgba(var(--WDS-systems-bubble-surface-outgoing-RGB), 1); }
      button { border-radius: 8px; }
      .avatar { border-radius: 50%; }
    </style><style>
  )HTML") + stylesheet + R"HTML(</style><style>
      #app,#app :not([data-icon]):not(code):not(pre) { font-family: serif !important; }
    </style>
    <div id="app"><div id="main">
      <div class="incoming">Incoming</div><div class="outgoing">Outgoing</div>
      <div class="fade">Gradient color</div><button>Send</button><img class="avatar">
      <code><span>code</span></code>
    </div></div>
  )HTML");
  return app.exec();
}
