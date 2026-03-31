import { NativeAnimation } from "./NativeAnimation"
import { AnyResolvedKeyframe } from "./types"

export class NativeAnimationWrapper<
    T extends AnyResolvedKeyframe
> extends NativeAnimation<T> {
    constructor(animation: Animation) {
        super()

        this.animation = animation
        animation.onfinish = () => {
            this.finishedTime = this.time
            this.notifyFinished()
        }
    }
}
