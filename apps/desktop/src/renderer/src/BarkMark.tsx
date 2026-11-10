import pine from './assets/bark/bark-pine.png'
import white from './assets/bark/bark-white.png'

/** Both exports use the approved mark's identical, optically centered silhouette. */
export function BarkMark({ size = 28 }: { size?: number }): React.JSX.Element {
  return (
    <span
      aria-hidden="true"
      style={{ display: 'inline-flex', flex: 'none', width: size, height: size }}
    >
      <img className="bark-mark bark-mark-light" src={pine} width={size} height={size} alt="" />
      <img className="bark-mark bark-mark-dark" src={white} width={size} height={size} alt="" />
    </span>
  )
}
