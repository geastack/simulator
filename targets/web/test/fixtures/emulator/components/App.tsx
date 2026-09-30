import { ReactiveComponent } from '@geastack/core'
  export class App extends ReactiveComponent {
    count = 0
    template() { return <button class="probe" onClick={() => this.count++}>before: {this.count}</button> }
  }