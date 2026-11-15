import QtQuick
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "qml"
import "Model.js" as Model

BarWidget {
  id: root
  moduleName: "io.github.sette7blo.omaservarr"

  readonly property string pluginDir: (Quickshell.env("HOME") || "") + "/.config/omarchy/plugins/io.github.sette7blo.omaservarr"

  // Service.qml instance, provided by Omarchy's plugin host.
  readonly property var service: bar && bar.shell && typeof bar.shell.serviceFor === "function"
    ? bar.shell.serviceFor(moduleName) : null

  readonly property bool configured: service ? service.configured === true : false
  readonly property var summary: service ? service.summary : null
  readonly property int downloading: summary ? summary.downloading : 0
  readonly property string level: summary ? summary.level : "ok"

  readonly property color foreground: bar ? bar.barForeground : Commons.Color.foreground
  readonly property color dim: Qt.darker(foreground, 1.55)

  // Dim until connected, the urgent colour when a service is down or reports
  // an error, the accent while something is downloading.
  readonly property color iconColor: !configured ? dim
    : (level === "error" ? Commons.Color.urgent
      : (downloading > 0 ? Commons.Color.accent : foreground))

  // Built from counts only; no server text reaches the tooltip.
  readonly property string statusTooltip: {
    if (!configured) return "Servarr is not set up"
    var text = Model.summaryText(summary)
    return text ? "Servarr: " + text : "Servarr: nothing downloading"
  }

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  function injectPanel() {
    var target = panelLoader.item
    if (!target) return
    if ("bar" in target) target.bar = root.bar
    if ("service" in target) target.service = root.service
    if ("anchorItem" in target) target.anchorItem = button
    if ("hostWidget" in target) target.hostWidget = root
  }

  onBarChanged: injectPanel()
  onServiceChanged: injectPanel()

  // Panel contract for the bar's popout coordinator.
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false

  function open() {
    if (panelLoader.item) panelLoader.item.open()
  }
  function close() {
    if (panelLoader.item) panelLoader.item.close()
  }
  function togglePanel() {
    if (panelLoader.item) panelLoader.item.toggle()
  }
  function closeForPopoutSwitch() {
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  TextMetrics {
    id: countMetrics
    font.family: button.fontFamily
    font.pixelSize: button.fontSize
    text: button.labelText
  }

  BarIconButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // The slot is sized for a lone icon; widen it while the count shows.
    fixedWidth: vertical ? -1
      : slotSize + (labelText !== "" ? Math.ceil(countMetrics.width) + Style.space(4) : 0)
    labelText: root.configured && root.downloading > 0 ? String(root.downloading) : ""
    tooltipText: root.statusTooltip
    iconComponent: Component {
      TvIcon {
        size: Style.bar.iconCanvas
        iconColor: root.iconColor
        strokeWidth: 2.4

        Behavior on iconColor {
          enabled: !root.bar || root.bar.foregroundAnimationEnabled
          ColorAnimation { duration: Style.duration(160) }
        }
      }
    }
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.LeftButton) {
        root.togglePanel()
      } else if (buttonCode === Qt.MiddleButton) {
        if (root.service) root.service.refreshAll()
      } else if (buttonCode === Qt.RightButton) {
        Util.execArgv(["xdg-open", root.pluginDir + "/README.md"])
      }
    }
  }
}
