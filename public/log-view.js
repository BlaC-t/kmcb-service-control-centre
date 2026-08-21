export function adjustedLogScrollTop(oldScrollTop, oldScrollHeight, newScrollHeight) {
  const removedHeight = Math.max(0, Number(oldScrollHeight) - Number(newScrollHeight))
  return Math.max(0, Number(oldScrollTop) - removedHeight)
}
