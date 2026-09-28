import { useEffect, useRef } from 'react'
import Phaser from 'phaser'
import { useGameStore } from './gameStore'

type PhaserGameProps = {
  onTreeClick: () => void
}

class IslandScene extends Phaser.Scene {
  private readonly onTreeClick: () => void
  private tree!: Phaser.GameObjects.Container
  private clickPulse = 0

  constructor(onTreeClick: () => void) {
    super('IslandScene')
    this.onTreeClick = onTreeClick
  }

  create() {
    const { width, height } = this.scale
    const centerX = width / 2
    const centerY = height / 2 + 22

    this.add.rectangle(0, 0, width, height, 0x071d2b).setOrigin(0)
    this.add.circle(centerX - 210, 82, 4, 0xffdf9b)
    this.add.circle(centerX + 220, 120, 3, 0x9ee7d6)
    this.add.circle(centerX + 175, 52, 2, 0xffffff)
    this.add.ellipse(centerX, centerY + 22, 560, 250, 0x08151e, 0.4)
    this.add.ellipse(centerX, centerY, 540, 230, 0x55bc9a)
    this.add.ellipse(centerX, centerY - 10, 475, 185, 0x85d7a8)
    const shoreline = this.add.arc(centerX, centerY + 4, 245, 205, 338, false)
    shoreline.setStrokeStyle(8, 0xf3d27a, 0.7)
    this.add.ellipse(centerX - 120, centerY + 45, 110, 24, 0x319278, 0.45)
    this.add.ellipse(centerX + 140, centerY - 6, 82, 18, 0x319278, 0.38)

    this.add.text(centerX, 44, 'ИЗУМРУДНЫЙ ОСТРОВ', {
      color: '#d7f6de',
      fontFamily: 'Georgia, serif',
      fontSize: '14px',
      letterSpacing: 4,
    }).setOrigin(0.5).setAlpha(0.78)

    this.createTree(centerX, centerY - 42)
  }

  private createTree(x: number, y: number) {
    this.tree = this.add.container(x, y)

    const shadow = this.add.ellipse(0, 104, 118, 24, 0x297c6a, 0.42)
    const trunk = this.add.rectangle(0, 55, 34, 112, 0x7e4f32).setOrigin(0.5, 0.5)
    const trunkLight = this.add.rectangle(-6, 55, 7, 98, 0xb97645).setOrigin(0.5, 0.5)
    const canopyBack = this.add.circle(0, -12, 88, 0x176b5d)
    const canopy = this.add.circle(0, -28, 76, 0x239476)
    const canopyLight = this.add.circle(-25, -53, 35, 0x62cf93)
    const canopyGlow = this.add.circle(25, -14, 26, 0xc4f276, 0.9)
    const fruit = this.add.circle(13, -12, 9, 0xffd36e)

    this.tree.add([shadow, trunk, trunkLight, canopyBack, canopy, canopyLight, canopyGlow, fruit])
    this.tree.setSize(190, 220)
    this.tree.setInteractive({ useHandCursor: true })
    this.tree.on('pointerover', () => this.tree.setScale(1.04))
    this.tree.on('pointerout', () => this.tree.setScale(1))
    this.tree.on('pointerdown', (pointer: Phaser.Input.Pointer) => {
      this.onTreeClick()
      this.clickPulse += 1
      this.showEnergyBurst(pointer.x, pointer.y)
      this.tweens.add({
        targets: this.tree,
        scale: 0.94,
        duration: 70,
        yoyo: true,
        ease: 'Quad.easeOut',
      })
    })
  }

  private showEnergyBurst(x: number, y: number) {
    const burst = this.add.text(x, y - 20, `+${useGameStore.getState().clickPower} энергии`, {
      color: '#fff2b2',
      fontFamily: 'Trebuchet MS, sans-serif',
      fontSize: '18px',
      fontStyle: 'bold',
      stroke: '#194b4e',
      strokeThickness: 5,
    }).setOrigin(0.5)

    this.tweens.add({
      targets: burst,
      y: y - 80,
      alpha: 0,
      duration: 700,
      ease: 'Cubic.easeOut',
      onComplete: () => burst.destroy(),
    })
  }
}

export function PhaserGame({ onTreeClick }: PhaserGameProps) {
  const gameParent = useRef<HTMLDivElement>(null)
  const game = useRef<Phaser.Game | null>(null)

  useEffect(() => {
    if (!gameParent.current) return

    game.current = new Phaser.Game({
      type: Phaser.AUTO,
      parent: gameParent.current,
      width: 760,
      height: 560,
      transparent: true,
      render: { antialias: true },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: 760,
        height: 560,
      },
      scene: new IslandScene(onTreeClick),
    })

    return () => {
      game.current?.destroy(true)
      game.current = null
    }
  }, [onTreeClick])

  return <div ref={gameParent} className="phaser-mount" aria-label="Интерактивная сцена острова" />
}

