/**
 * The app's own name, where the system title bar used to be.
 *
 * With `titleBarStyle: 'hidden'` Windows stops drawing the bar, the title and
 * the icon, and keeps only the caption buttons as an overlay. The window is
 * then the renderer's all the way to the top edge -- which is the point, since
 * the backdrop can run up into it -- but two things have to come back.
 *
 * The name is one. The other is **dragging**: with no system bar there is
 * nothing to pick the window up by, so this strip declares itself a drag
 * region. That is also why it is only a strip and not the whole top of the
 * scene: a drag region swallows clicks, and the close-up's corner preview and
 * the flat-lay's empty field both live up there.
 *
 * It carries no controls. Minimise, maximise and close are still Windows' own,
 * drawn over this strip at its right-hand end.
 */

export function TitleBar() {
  return (
    <div className="titlebar">
      <span className="titlebar__mark">Vuelta</span>
    </div>
  )
}
