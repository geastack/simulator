import { Component, mount } from '@geastack/core'
import { jsx } from '@geajs/core/jsx-runtime'

export class App extends Component {
  width = 150
  pointerX = 0
  styles = { width: 150, height: 20, opacity: 0.5 }
  attrs = { style: { width: 150, height: 20 } }
  template() {
    return <div>
      <div id="constant" style={{ width: 150, height: 20 }} />
      <div id="reactive" style={{ width: this.width, height: 20 }} />
      <div id="css" style={{ width: `${this.width}px`, height: '20px' }} />
      <div id="object" style={this.styles} />
      <div id="spread-object" style={{ ...this.styles }} />
      <div id="spread-attribute" {...this.attrs} />
      <div id="static-text" style="width:150; height:20" />
      <div id="dynamic-text" style={`width:${this.width}; height:20`} />
      <div id="unitless" style={{ fontSize: 20, lineHeight: 1.5, opacity: 0.5, zIndex: 3, '--value': 150 }} />
      <div id="relative" style={{ width: '50%', height: 20 }} />
      <div id="pointer" style={{ width: 150, height: 30 }} onPointerDown={event => { this.pointerX = event.clientX }} />
      <span id="pointer-x">{this.pointerX}</span>
      <button id="update" onClick={() => {
        this.width = 90
        this.styles = { width: 90, height: 30, opacity: 0.8 }
        this.attrs = { style: { width: 90, height: 30 } }
      }}>Update</button>
    </div>
  }
}

mount(App)
document.getElementById('app')!.insertAdjacentHTML('beforeend', jsx('div', { id: 'runtime-jsx', style: { width: 150, height: 20 } }))
