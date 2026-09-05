// One coordinate unit is one adult's standard size (circumcircle diameter).
// The reference stays fixed when an individual grows or the camera zooms.
export const LENGTH_UNIT='身长';
export const MIN_SIZE=.3,MAX_SIZE=1;
export const formatLength=value=>`${Number(value.toFixed(2)).toLocaleString('zh-CN')} ${LENGTH_UNIT}`;
