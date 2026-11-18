package ch.nmeylan.markdone.jcef

import org.cef.browser.CefBrowser
import org.cef.browser.CefFrame
import org.cef.callback.CefContextMenuParams
import org.cef.callback.CefMenuModel
import org.cef.handler.CefContextMenuHandlerAdapter

/** Removes Chromium's own context menu (Back, Reload, Inspect, ...); the IDE shows its menu instead. */
class ContextMenuHandler : CefContextMenuHandlerAdapter() {
    override fun onBeforeContextMenu(browser: CefBrowser?, frame: CefFrame?, params: CefContextMenuParams?, model: CefMenuModel) {
        model.clear()
    }
}
