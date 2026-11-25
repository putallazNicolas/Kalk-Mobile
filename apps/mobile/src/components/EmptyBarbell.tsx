import Svg, { Path, Rect } from 'react-native-svg';

import { colors } from '../theme';

/** The empty barbell of design/P02: plates are dashed outlines, nothing loaded yet. */
export function EmptyBarbell() {
  const dashed = {
    fill: 'none',
    stroke: colors.borderStrong,
    strokeWidth: 1.5,
    strokeDasharray: '4 4',
  } as const;
  return (
    <Svg
      width={320}
      height={110}
      viewBox="0 0 320 110"
      accessibilityLabel="Barra olímpica sin discos"
      accessibilityRole="image"
    >
      <Rect x={44} y={12} width={20} height={86} rx={4} {...dashed} />
      <Rect x={68} y={22} width={14} height={66} rx={3} {...dashed} />
      <Rect x={256} y={12} width={20} height={86} rx={4} {...dashed} />
      <Rect x={238} y={22} width={14} height={66} rx={3} {...dashed} />
      <Rect x={8} y={49} width={80} height={12} rx={3} fill={colors.border} />
      <Rect x={232} y={49} width={80} height={12} rx={3} fill={colors.border} />
      <Rect x={86} y={43} width={8} height={24} rx={2} fill={colors.borderStrong} />
      <Rect x={226} y={43} width={8} height={24} rx={2} fill={colors.borderStrong} />
      <Rect x={94} y={52} width={132} height={6} rx={3} fill={colors.textDisabled} />
      <Path
        d="M120 52v6M126 52v6M132 52v6M188 52v6M194 52v6M200 52v6"
        stroke={colors.borderStrong}
        strokeWidth={1}
      />
    </Svg>
  );
}
