# NAHTREEK Client V2 Design System

## Palette

| Role | Value | Use |
|---|---:|---|
| Primary Navy | `#111F35` | Brand, primary CTA, major anchors |
| Deep Navy | `#111F35` | High-emphasis headers and navigation |
| Rich Navy | `#111F35` | Layered navy surfaces |
| Construction Yellow | `#C4A639` | Primary actions, active navigation and progress |
| Pressed Yellow | `#C4A639` | Pressed interactive state |
| Soft Yellow | `#FFF4D8` | Selected and highlighted backgrounds |
| Accessible Accent Text | `#9A6700` | Yellow-family text on white surfaces |
| Very Light Blue | `#F3F7FD` | Quiet supporting surfaces |
| Background | `#F7F9FC` | App canvas |
| Surface | `#FFFFFF` | Cards, sheets and fields |
| Primary Text | `#172033` | Main copy |
| Secondary Text | `#667085` | Supporting copy |
| Border | `#E4E9F0` | Standard boundaries |
| Strong Border | `#D0D7E2` | Focused separation |
| Success | `#198754` | Confirmed success only |
| Warning | `#D97706` | Genuine warning only |
| Error | `#D14343` | Errors and destructive actions |

The Client and Engineer applications share the navy/white/construction-yellow identity. Yellow is used selectively for primary actions, active navigation, progress and highlights; ordinary body text remains navy/slate for readability.

## Components and interaction

- Primary actions use construction yellow with deep-navy text. Secondary actions use white or quiet neutral surfaces with navy text.
- Outline actions use white, navy border and navy text. Destructive actions use error styling only.
- Buttons expose disabled and loading states and use controlled opacity feedback.
- Touch targets are at least 44 logical pixels. Fields retain visible labels and strong navy/yellow focus treatment.
- Cards use 12–20 px radii and subtle navy/slate shadows. Avoid decorative borders and excessive elevation.
- Screen loading uses skeletons or compact inline progress; empty and error states provide one relevant action.
- Respect font scaling, logical reading order, screen-reader labels and reduced motion.

## Responsive behavior

Content scrolls rather than clipping on small devices. Avoid fixed text containers. Bottom navigation accounts for safe-area insets. Sheets cap their height and keep primary actions reachable when the keyboard is open.
