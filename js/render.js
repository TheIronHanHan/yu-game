GameGlobal.canvas = wx.createCanvas();

const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
const pixelRatio = Math.min(windowInfo.pixelRatio || 1, 3);
const menuButtonRect = wx.getMenuButtonBoundingClientRect
  ? wx.getMenuButtonBoundingClientRect()
  : null;

canvas.width = Math.round(windowInfo.screenWidth * pixelRatio);
canvas.height = Math.round(windowInfo.screenHeight * pixelRatio);

GameGlobal.safeArea = windowInfo.safeArea || {
  top: 0,
  right: windowInfo.screenWidth,
  bottom: windowInfo.screenHeight,
  left: 0,
  width: windowInfo.screenWidth,
  height: windowInfo.screenHeight,
};
GameGlobal.menuButtonBottom = menuButtonRect && menuButtonRect.bottom
  ? menuButtonRect.bottom
  : GameGlobal.safeArea.top;

export const SCREEN_WIDTH = windowInfo.screenWidth;
export const SCREEN_HEIGHT = windowInfo.screenHeight;
export const PIXEL_RATIO = pixelRatio;
