// Lucide `tv` — https://lucide.dev/icons/tv (ISC license).
// Drawn as paths so the icon stays recolorable at runtime.
import QtQuick
import QtQuick.Shapes

Item {
  id: root

  property real size: 14
  property color iconColor: "white"
  property real strokeWidth: 2

  implicitWidth: size
  implicitHeight: size

  Shape {
    anchors.fill: parent
    preferredRendererType: Shape.CurveRenderer
    transformOrigin: Item.TopLeft
    scale: root.size / 24

    ShapePath {
      strokeWidth: root.strokeWidth
      strokeColor: root.iconColor
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap
      joinStyle: ShapePath.RoundJoin
      PathSvg { path: "M17 2 l-5 5 l-5 -5" }
    }
    ShapePath {
      strokeWidth: root.strokeWidth
      strokeColor: root.iconColor
      fillColor: "transparent"
      capStyle: ShapePath.RoundCap
      joinStyle: ShapePath.RoundJoin
      PathSvg { path: "M4 7 h16 a2 2 0 0 1 2 2 v11 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 v-11 a2 2 0 0 1 2 -2 z" }
    }
  }
}
