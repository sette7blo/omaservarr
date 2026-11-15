import QtQuick
import QtQuick.Layouts
import qs.Commons
import qs.Ui

// One line of a panel list: either a section header, or a title with an
// optional second line, a right-hand note and a progress bar. All text comes
// from the servers, so every Text is plain.
Item {
  id: root

  property var entry: ({})
  property string serviceLabel: ""
  property color foreground: Color.foreground
  property color accent: Color.accent
  property string fontFamily: Style.font.family

  readonly property color dim: Qt.darker(foreground, 1.55)
  readonly property bool isHeader: !!entry && entry.header !== ""
  readonly property bool clickable: !isHeader && !!entry && (entry.path !== "" || entry.url !== "")
  readonly property string tone: entry ? entry.tone : ""
  readonly property color titleColor: tone === "error" ? Color.urgent : (tone === "dim" ? dim : foreground)
  readonly property color noteColor: tone === "error" ? Color.urgent : (tone === "warn" ? foreground : dim)

  signal activated(var entry)

  implicitHeight: isHeader ? header.implicitHeight + Style.spacing.md : content.implicitHeight + Style.spacing.md * 2

  Rectangle {
    anchors.fill: parent
    visible: root.clickable && mouse.containsMouse
    color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.07)
    radius: Style.cornerRadius
  }

  PanelSectionHeader {
    id: header
    visible: root.isHeader
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.bottom: parent.bottom
    anchors.leftMargin: Style.spacing.md
    text: root.entry ? root.entry.header : ""
    foreground: root.foreground
    fontFamily: root.fontFamily
    elide: Text.ElideRight
  }

  Column {
    id: content
    visible: !root.isHeader
    anchors.left: parent.left
    anchors.right: parent.right
    anchors.verticalCenter: parent.verticalCenter
    anchors.leftMargin: Style.spacing.md
    anchors.rightMargin: Style.spacing.md
    spacing: Style.spacing.xxs

    RowLayout {
      width: parent.width
      spacing: Style.spacing.lg

      Text {
        textFormat: Text.PlainText
        Layout.fillWidth: true
        text: root.entry ? root.entry.title : ""
        color: root.titleColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        elide: Text.ElideRight
        maximumLineCount: 1
      }
      Text {
        textFormat: Text.PlainText
        visible: text !== ""
        text: root.entry ? root.entry.right : ""
        color: root.noteColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        font.bold: root.tone === "warn"
        maximumLineCount: 1
      }
    }

    RowLayout {
      width: parent.width
      spacing: Style.spacing.lg

      Text {
        textFormat: Text.PlainText
        Layout.fillWidth: true
        text: root.entry ? root.entry.subtitle : ""
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.bodySmall
        elide: Text.ElideRight
        maximumLineCount: 1
      }
      Text {
        textFormat: Text.PlainText
        visible: text !== ""
        text: root.serviceLabel
        color: root.dim
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
        maximumLineCount: 1
      }
    }

    Item {
      visible: !!root.entry && root.entry.progress >= 0
      width: parent.width
      height: visible ? Style.space(3) + Style.spacing.xxs : 0

      Rectangle {
        anchors.left: parent.left
        anchors.right: parent.right
        anchors.bottom: parent.bottom
        height: Style.space(3)
        radius: height / 2
        color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.15)

        Rectangle {
          width: parent.width * Math.max(0, Math.min(1, root.entry ? root.entry.progress : 0))
          height: parent.height
          radius: parent.radius
          color: root.tone === "error" ? Color.urgent : root.accent
        }
      }
    }
  }

  MouseArea {
    id: mouse
    anchors.fill: parent
    enabled: root.clickable
    hoverEnabled: true
    cursorShape: root.clickable ? Qt.PointingHandCursor : Qt.ArrowCursor
    onClicked: root.activated(root.entry)
  }
}
