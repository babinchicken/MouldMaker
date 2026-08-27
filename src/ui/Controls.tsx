import { SPRUE_MODES, maxBaseKeyHeight, maxResolution, reconcile, type MouldParams, type SprueMode } from '../mould/params'

interface Props {
  params: MouldParams
  onChange: (next: MouldParams) => void
  disabled: boolean
}

/** A pick-one control. Everything else on this panel is a number with a slider. */
interface Choice {
  key: 'sprueMode'
  label: string
  choices: typeof SPRUE_MODES
}

const isChoice = (field: Field | Choice): field is Choice => 'choices' in field

interface Field {
  key: keyof MouldParams
  label: string
  min: number
  /** Fixed ceiling, or one derived from the other settings. */
  max: number | ((p: MouldParams) => number)
  step: number
  hint?: string | ((p: MouldParams) => string)
}

const GROUPS: Array<{ title: string; fields: Array<Field | Choice> }> = [
  {
    title: 'Parting plane',
    fields: [
      {
        key: 'partingAngleDeg', label: 'Seam bearing', min: 0, max: 180, step: 5,
        hint: (p) => {
          const a = ((p.partingAngleDeg % 180) + 180) % 180
          const named = a === 0 ? ' — left / right' : a === 90 ? ' — front / back' : ''
          return `${a}°${named}. Turn the seam away from a face or an ornament.`
        },
      },
    ],
  },
  {
    title: 'Size',
    fields: [
      {
        key: 'targetHeightMM', label: 'Model height', min: 20, max: 300, step: 5,
        hint: 'The master is always scaled to this — STL carries no units',
      },
    ],
  },
  {
    title: 'Silicone',
    fields: [
      { key: 'siliconeThicknessMM', label: 'Skin thickness', min: 1.5, max: 12, step: 0.5, hint: 'Wall thickness of the finished mould' },
      {
        key: 'resolutionMM', label: 'Detail resolution', min: 0.2, step: 0.1,
        // Anything coarser than half the thinnest feature and marching tetrahedra
        // steps straight over the silicone gap, so the jacket comes out solid.
        // The slider used to run to 2.0 and hand you a validation error instead.
        max: maxResolution,
        hint: (p) =>
          `Grid spacing — finer costs time cubically. Capped at ${maxResolution(p).toFixed(2)}mm by your thinnest feature.`,
      },
    ],
  },
  {
    title: 'Jacket',
    fields: [
      { key: 'jacketWallMM', label: 'Wall thickness', min: 1.6, max: 8, step: 0.2 },
      { key: 'flangeWidthMM', label: 'Flange width', min: 0, max: 30, step: 1 },
      { key: 'flangeThicknessMM', label: 'Flange thickness', min: 0, max: 12, step: 0.5, hint: 'Per half' },
      { key: 'boltHoleDiameterMM', label: 'Bolt hole ⌀', min: 0, max: 8, step: 0.1 },
      { key: 'boltCount', label: 'Bolt count', min: 0, max: 16, step: 1 },
    ],
  },
  {
    title: 'Base',
    fields: [
      { key: 'plinthHeightMM', label: 'Plinth height', min: 2, max: 25, step: 1 },
      { key: 'plinthMarginMM', label: 'Plinth overhang', min: 0, max: 20, step: 1, hint: 'How far it sticks out past the jacket' },
      {
        key: 'baseKeyHeightMM', label: 'Keyed seat', min: 0, max: maxBaseKeyHeight, step: 0.5,
        hint: (p) => p.baseKeyHeightMM > 0
          ? `The jacket foot drops ${p.baseKeyHeightMM}mm into a recess in the plinth, so it can only sit one way. Capped at ${maxBaseKeyHeight(p).toFixed(1)}mm by the silicone gap.`
          : 'Off. The jacket sits on a flat plinth and can slide or spin on it.',
      },
      {
        key: 'brimWidthMM', label: 'Silicone brim', min: 0, max: 50, step: 1,
        hint: (p) => p.brimWidthMM > 0
          ? `A ${p.brimWidthMM}mm flange of silicone round the foot, ${p.siliconeThicknessMM}mm thick — to clamp, or to key a plaster mother mould to.`
          : 'Off. A flat skirt of silicone round the foot, like a slicer brim.',
      },
    ],
  },
  {
    title: 'Standing square & pour',
    fields: [
      { key: 'standSquareSideMM', label: 'Pad side', min: 10, max: 80, step: 2 },
      { key: 'standSquareThicknessMM', label: 'Pad thickness', min: 1.5, max: 12, step: 0.5 },
      { key: 'sprueDiameterMM', label: 'Sprue ⌀', min: 0, max: 20, step: 0.5 },
      { key: 'sprueMode', label: 'Sprue arrangement', choices: SPRUE_MODES },
      { key: 'ventDiameterMM', label: 'Vent ⌀', min: 0, max: 5, step: 0.2 },
    ],
  },
]

export default function Controls({ params, onChange, disabled }: Props) {
  const set = (key: keyof MouldParams, value: number | SprueMode) =>
    onChange(reconcile({ ...params, [key]: value }))
  const resolve = <T,>(value: T | ((p: MouldParams) => T)): T =>
    typeof value === 'function' ? (value as (p: MouldParams) => T)(params) : value

  return (
    <div className="controls">
      {GROUPS.map((group) => (
        <div className="group" key={group.title}>
          <h3>{group.title}</h3>
          {group.fields.map((field) => {
            if (isChoice(field)) {
              const current = params[field.key]
              return (
                <div className="choice" key={field.key}>
                  <span>{field.label}</span>
                  <div className="segments">
                    {field.choices.map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={disabled}
                        aria-pressed={current === option.value}
                        className={current === option.value ? 'on' : ''}
                        onClick={() => set(field.key, option.value)}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                  <small>{field.choices.find((o) => o.value === current)?.hint}</small>
                </div>
              )
            }
            const max = resolve(field.max)
            const hint = field.hint && resolve(field.hint)
            // A number input's min/max only style the box, they don't stop typing —
            // so clamp on the way in rather than letting an out-of-range value
            // reach the generator.
            const clamp = (value: number) => Math.min(max, Math.max(field.min, value))
            return (
              <label key={field.key as string}>
                <span className="row">
                  <span>{field.label}</span>
                  <input
                    type="number"
                    disabled={disabled}
                    value={params[field.key] as number}
                    min={field.min}
                    max={max}
                    step={field.step}
                    onChange={(e) => set(field.key, clamp(Number(e.target.value)))}
                  />
                </span>
                <input
                  type="range"
                  disabled={disabled}
                  value={params[field.key] as number}
                  min={field.min}
                  max={max}
                  step={field.step}
                  onChange={(e) => set(field.key, clamp(Number(e.target.value)))}
                />
                {hint && <small>{hint}</small>}
              </label>
            )
          })}
        </div>
      ))}
    </div>
  )
}
