import { useEffect, useRef } from 'react'
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'

export interface ViewerPart {
  name: string
  positions: Float32Array
  colour: number
  visible: boolean
  /** Drawn see-through, so the master stays readable inside the jacket. */
  ghost?: boolean
}

interface Props {
  parts: ViewerPart[]
}

/**
 * Plain three.js viewer. Parts are rebuilt whenever the list changes, but the
 * renderer, camera and controls persist — so tweaking visibility doesn't throw
 * away the angle the user just framed up.
 */
export default function Viewer({ parts }: Props) {
  const mount = useRef<HTMLDivElement>(null)
  const group = useRef<THREE.Group | null>(null)
  /** Set when new parts arrive; the render loop clears it once it has framed them. */
  const wantsFraming = useRef(false)
  const framed = useRef(false)

  useEffect(() => {
    const host = mount.current
    if (!host) return

    const renderer = new THREE.WebGLRenderer({ antialias: true })
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio))
    host.appendChild(renderer.domElement)

    const scene = new THREE.Scene()
    scene.background = new THREE.Color(0x14161a)

    const camera = new THREE.PerspectiveCamera(40, 1, 0.5, 5000)
    camera.up.set(0, 0, 1)
    camera.position.set(240, -260, 190)

    const orbit = new OrbitControls(camera, renderer.domElement)
    orbit.enableDamping = true

    scene.add(new THREE.HemisphereLight(0xffffff, 0x333344, 2.1))
    const key = new THREE.DirectionalLight(0xffffff, 2.2)
    key.position.set(1, -1.4, 1.6)
    scene.add(key)
    const fill = new THREE.DirectionalLight(0x99bbff, 0.7)
    fill.position.set(-1.2, 0.9, 0.4)
    scene.add(fill)

    const grid = new THREE.GridHelper(400, 40, 0x2c313c, 0x22262e)
    grid.rotation.x = Math.PI / 2
    scene.add(grid)

    const theGroup = new THREE.Group()
    scene.add(theGroup)
    group.current = theGroup

    // Size and framing are both driven from the render loop rather than from a
    // ResizeObserver and an effect. The case that actually bites is mounting into
    // a container that is still zero-sized: the observer never fires again, the
    // canvas stays stuck at three's 600x300 default, and any framing done in the
    // meantime used a meaningless aspect ratio.
    let width = 0
    let height = 0

    const reconcileSize = (): boolean => {
      const { clientWidth, clientHeight } = host
      if (!clientWidth || !clientHeight) return false
      if (clientWidth !== width || clientHeight !== height) {
        width = clientWidth
        height = clientHeight
        renderer.setSize(width, height)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
      }
      return true
    }

    const frameContents = () => {
      const box = new THREE.Box3().setFromObject(theGroup)
      if (box.isEmpty()) return
      const centre = box.getCenter(new THREE.Vector3())
      const radius = box.getSize(new THREE.Vector3()).length() / 2
      // Back off far enough for the bounding sphere to fit the narrower of the two
      // fields of view. A fixed multiple of the radius crops a tall model on a wide
      // viewport, which is exactly the shape a standing figure has.
      const vertical = (camera.fov * Math.PI) / 180
      const horizontal = 2 * Math.atan(Math.tan(vertical / 2) * camera.aspect)
      const distance = (radius / Math.sin(Math.min(vertical, horizontal) / 2)) * 1.15
      orbit.target.copy(centre)
      camera.position.copy(centre).addScaledVector(new THREE.Vector3(0.7, -1, 0.42).normalize(), distance)
      camera.updateProjectionMatrix()
      framed.current = true
      wantsFraming.current = false
    }

    let running = true
    const tick = () => {
      if (!running) return
      const ready = reconcileSize()
      if (ready && wantsFraming.current) frameContents()
      orbit.update()
      renderer.render(scene, camera)
      requestAnimationFrame(tick)
    }
    tick()

    return () => {
      running = false
      orbit.dispose()
      renderer.dispose()
      host.removeChild(renderer.domElement)
    }
  }, [])

  useEffect(() => {
    const theGroup = group.current
    if (!theGroup) return

    for (const child of [...theGroup.children]) {
      theGroup.remove(child)
      const mesh = child as THREE.Mesh
      mesh.geometry?.dispose()
      ;(mesh.material as THREE.Material | undefined)?.dispose()
    }

    for (const part of parts) {
      if (!part.visible) continue
      const geometry = new THREE.BufferGeometry()
      geometry.setAttribute('position', new THREE.BufferAttribute(part.positions, 3))
      geometry.computeVertexNormals()
      const material = new THREE.MeshStandardMaterial({
        color: part.colour,
        roughness: 0.55,
        metalness: 0.05,
        transparent: !!part.ghost,
        opacity: part.ghost ? 0.35 : 1,
        side: THREE.DoubleSide,
      })
      theGroup.add(new THREE.Mesh(geometry, material))
    }

    if (!framed.current && parts.length > 0) wantsFraming.current = true
  }, [parts])

  return <div className="viewer" ref={mount} />
}
