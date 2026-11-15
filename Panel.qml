import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import Quickshell
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "qml"
import "Model.js" as Model

Panel {
  id: root
  moduleName: "io.github.sette7blo.omaservarr"
  ipcTarget: "io.github.sette7blo.omaservarr"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property bool showSettings: false
  property string tab: "queue"
  property string libraryFilter: ""
  property string libraryOnly: ""
  property string libraryService: ""

  readonly property var barIdentity: hostWidget || root

  readonly property color foreground: bar ? bar.foreground : Commons.Color.foreground
  readonly property color accent: Commons.Color.accent
  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family

  readonly property bool configured: service ? service.configured === true : false
  readonly property var ids: service ? service.configuredIds : []
  readonly property var snapshot: service ? service.snapshot : null
  readonly property var summary: service ? service.summary : null
  readonly property bool showLists: !showSettings && configured
  // A service that has since been disconnected no longer filters anything.
  readonly property string activeService: ids.indexOf(libraryService) !== -1 ? libraryService : ""
  readonly property bool typing: (settingsLoader.item ? settingsLoader.item.editorOpen === true : false)
    || filterField.activeFocus

  readonly property string heroMeta: {
    if (showSettings) return "Settings"
    if (!configured) return "Not connected"
    return Model.summaryText(summary) || "Nothing downloading"
  }

  readonly property var tabOptions: {
    var queued = summary ? summary.queued : 0
    var issues = summary ? summary.issues : 0
    return [
      { value: "queue", label: queued > 0 ? "Queue " + queued : "Queue" },
      { value: "upcoming", label: "Upcoming" },
      { value: "recent", label: "Recent" },
      { value: "library", label: "Library" },
      { value: "health", label: issues > 0 ? "Health " + issues : "Health" }
    ]
  }

  readonly property var rows: {
    if (!showLists || !snapshot) return []
    if (tab === "queue") return Model.queueRows(snapshot, ids)
    if (tab === "upcoming") return Model.calendarRows(snapshot, ids, new Date())
    if (tab === "recent") return Model.recentRows(snapshot, ids, new Date())
    if (tab === "health") return Model.healthRows(snapshot, ids)
    return Model.libraryRows(snapshot, ids, libraryFilter, libraryOnly, activeService)
  }

  readonly property bool libraryLoading: {
    if (!snapshot) return false
    for (var i = 0; i < ids.length; i++) {
      if (activeService !== "" && ids[i] !== activeService) continue
      var s = snapshot[ids[i]]
      if (s && !s.libraryLoaded && s.status !== "unreachable" && s.status !== "unauthorized") return true
    }
    return false
  }

  readonly property string emptyText: {
    if (tab === "queue") return "Nothing in the queue."
    if (tab === "upcoming") {
      var days = service ? service.calendarDays : Model.DEFAULT_CALENDAR_DAYS
      return days === 1 ? "Nothing today." : "Nothing in the next " + days + " days."
    }
    if (tab === "recent") return "No recent imports."
    if (tab === "health") return "All services are healthy."
    if (libraryLoading) return "Loading the library."
    return libraryFilter !== "" || libraryOnly !== "" || activeService !== "" ? "No matches." : "The library is empty."
  }

  function loadLibraryIfShown() {
    if (root.opened && root.tab === "library" && root.service) root.service.ensureLibrary(false)
  }

  onTabChanged: loadLibraryIfShown()

  Connections {
    target: root
    function onOpenedChanged() {
      if (root.service) root.service.panelOpen = root.opened
      if (!root.opened) root.showSettings = false
      root.loadLibraryIfShown()
    }
  }

  // Server-supplied values only ever travel as separate arguments, never as
  // part of a shell command line.
  function openEntry(entry) {
    if (!entry || !root.hostWidget) return
    if (entry.url !== "") Util.execArgv(["xdg-open", entry.url])
    else Util.execArgv([root.hostWidget.pluginDir + "/bin/omaservarr", "open", entry.service, entry.path || "/"])
    close()
  }

  function openService(id) {
    if (!root.hostWidget) return
    Util.execArgv([root.hostWidget.pluginDir + "/bin/omaservarr", "open", id, "/"])
    close()
  }

  Component {
    id: settingsComp
    SettingsView {
      width: body.width
      service: root.service
      foreground: root.foreground
      accent: root.accent
      fontFamily: root.fontFamily
      onCloseSettings: root.showSettings = false
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    contentWidth: panel.fittedContentWidth(Style.space(420))
    contentHeight: panel.fittedContentHeight(body.implicitHeight, Style.space(720))

    PanelKeyCatcher {
      anchors.fill: parent
      blocked: root.typing
      onCloseRequested: root.close()
    }

    Column {
      id: body
      width: parent.width
      spacing: Style.spacing.xxl

      PanelHero {
        title: "Servarr"
        meta: root.heroMeta
        foreground: root.foreground
        fontFamily: root.fontFamily
        iconComponent: Component {
          TvIcon {
            size: Style.font.display
            iconColor: root.foreground
            strokeWidth: 1.75
          }
        }
        trailingControl: Component {
          Row {
            spacing: Style.spacing.md

            PanelActionButton {
              visible: root.showLists
              iconText: "\u{f0450}"
              tooltipText: "Refresh"
              opacity: root.service && root.service.busy ? 0.45 : 1
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: if (root.service) root.service.refreshAll()
            }
            PanelActionButton {
              iconText: root.showSettings ? "\u{f0156}" : "\u{f0493}"
              tooltipText: root.showSettings ? "Close settings" : "Settings"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onClicked: root.showSettings = !root.showSettings
            }
          }
        }
      }

      PanelSeparator { foreground: root.foreground }

      Loader {
        id: settingsLoader
        width: parent.width
        active: root.showSettings
        visible: active
        sourceComponent: settingsComp
      }

      // ---- Not connected ----
      Column {
        width: parent.width
        spacing: Style.spacing.lg
        visible: !root.showSettings && !root.configured

        Text {
          textFormat: Text.PlainText
          width: parent.width
          text: "Connect Sonarr, Radarr or Lidarr to see downloads, releases and health here."
          color: root.foreground
          wrapMode: Text.WordWrap
          font.family: root.fontFamily
          font.pixelSize: Style.font.body
        }
        Button {
          text: "Connect"
          bordered: true
          foreground: root.foreground
          accent: root.accent
          fontFamily: root.fontFamily
          onClicked: root.showSettings = true
        }
      }

      // ---- Tabs ----
      ButtonGroup {
        visible: root.showLists
        options: root.tabOptions
        value: root.tab
        fontSize: Style.font.bodySmall
        focusable: false
        foreground: root.foreground
        accent: root.accent
        fontFamily: root.fontFamily
        onChanged: function(value) { root.tab = value }
      }

      // ---- Library filter and totals ----
      Column {
        width: parent.width
        spacing: Style.spacing.lg
        visible: root.showLists && root.tab === "library"

        RowLayout {
          width: parent.width
          spacing: Style.spacing.lg

          TextField {
            id: filterField
            Layout.fillWidth: true
            placeholderText: "Filter by title"
            foreground: root.foreground
            accent: root.accent
            onTextEdited: root.libraryFilter = text
          }
          ButtonGroup {
            options: [{ value: "", label: "All" }, { value: "missing", label: "Missing" }]
            value: root.libraryOnly
            fontSize: Style.font.bodySmall
            focusable: false
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onChanged: function(value) { root.libraryOnly = value }
          }
        }

        // Totals per service. With more than one service connected a line
        // also filters the list to that service; pressing it again clears it.
        Column {
          width: parent.width

          Repeater {
            model: root.ids
            delegate: Item {
              id: totals
              required property var modelData
              readonly property string line: Model.librarySummary(root.snapshot, modelData)
              readonly property bool pickable: root.ids.length > 1
              readonly property bool picked: root.activeService === modelData
              readonly property bool muted: root.activeService !== "" && !picked

              width: parent.width
              visible: line !== "" || pickable
              implicitHeight: totalsRow.implicitHeight + Style.spacing.lg

              Rectangle {
                anchors.fill: parent
                visible: totals.pickable && totalsMouse.containsMouse
                color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.07)
                radius: Style.cornerRadius
              }

              RowLayout {
                id: totalsRow
                anchors.left: parent.left
                anchors.right: parent.right
                anchors.verticalCenter: parent.verticalCenter
                anchors.leftMargin: Style.spacing.md
                anchors.rightMargin: Style.spacing.md
                spacing: Style.spacing.xxl

                Text {
                  textFormat: Text.PlainText
                  Layout.preferredWidth: Style.space(60)
                  text: Model.serviceName(totals.modelData)
                  color: totals.picked ? root.accent : root.dim
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  font.bold: totals.picked
                  Behavior on color { ColorAnimation { duration: Style.duration(160) } }
                }
                Text {
                  textFormat: Text.PlainText
                  Layout.fillWidth: true
                  text: totals.line
                  color: totals.muted ? root.dim : root.foreground
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.bodySmall
                  elide: Text.ElideRight
                  Behavior on color { ColorAnimation { duration: Style.duration(160) } }
                }
              }

              MouseArea {
                id: totalsMouse
                anchors.fill: parent
                enabled: totals.pickable
                hoverEnabled: true
                cursorShape: totals.pickable ? Qt.PointingHandCursor : Qt.ArrowCursor
                onClicked: root.libraryService = totals.picked ? "" : totals.modelData
              }
            }
          }
        }
      }

      // ---- List ----
      ListView {
        id: list
        width: parent.width
        height: Math.min(contentHeight, Style.space(360))
        visible: root.showLists && count > 0
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        interactive: contentHeight > height
        model: root.rows
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        delegate: RowItem {
          required property var modelData
          width: list.width
          entry: modelData
          serviceLabel: Model.serviceName(modelData.service)
          foreground: root.foreground
          accent: root.accent
          fontFamily: root.fontFamily
          onActivated: function(entry) { root.openEntry(entry) }
        }
      }

      Text {
        textFormat: Text.PlainText
        width: parent.width
        visible: root.showLists && list.count === 0
        text: root.emptyText
        color: root.dim
        wrapMode: Text.WordWrap
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
      }

      PanelSeparator {
        foreground: root.foreground
        visible: root.showLists
      }

      // ---- Actions ----
      RowLayout {
        width: parent.width
        spacing: Style.spacing.lg
        visible: root.showLists

        Repeater {
          model: root.ids
          delegate: Button {
            required property var modelData
            Layout.fillWidth: true
            text: "Open " + Model.serviceName(modelData)
            bordered: true
            foreground: root.foreground
            accent: root.accent
            fontFamily: root.fontFamily
            onClicked: root.openService(modelData)
          }
        }
      }
    }
  }
}
