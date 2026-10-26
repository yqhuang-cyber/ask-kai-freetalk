import {AudioIO as NativeAudioIO} from '/native-audio.js';
// Fixture dependency only: real output AudioContext, silence input, no microphone.
export class AudioIO extends NativeAudioIO {
  async start(){this.stopCapture();this.fixtureTimer=setInterval(()=>this.onFrame(new Uint8Array(640)),20);}
  stopCapture(){clearInterval(this.fixtureTimer);super.stopCapture();}
}
