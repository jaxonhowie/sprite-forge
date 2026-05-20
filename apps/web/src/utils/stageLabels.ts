/** Video job stage labels */
export const videoStageLabels: Record<string, string> = {
  extract: '截帧',
  inpaint: '去水印',
  light: '统一灯光',
  rembg: '去背景',
  pack: '打包精灵表',
  done: '完成',
};

/** Image job stage labels */
export const imageStageLabels: Record<string, string> = {
  crop: '裁切图块',
  rembg: '去背景',
  pack: '生成精灵表',
  done: '处理完成',
};
