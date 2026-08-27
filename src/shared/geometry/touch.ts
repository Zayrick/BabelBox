/** 仅在触摸点数量精确匹配时计算中心点。 */
export function getCenterPoint(
    touches: Pick<TouchList, 'length' | 'item'> & {[index: number]: Pick<Touch, 'clientX' | 'clientY'>},
    requiredTouches: number,
): {x: number; y: number} | undefined {
    if (touches.length !== requiredTouches || touches.length === 0) return undefined;

    let centerX = 0;
    let centerY = 0;
    for (let index = 0; index < touches.length; index += 1) {
        centerX += touches[index].clientX;
        centerY += touches[index].clientY;
    }

    return {
        x: centerX / touches.length,
        y: centerY / touches.length,
    };
}
