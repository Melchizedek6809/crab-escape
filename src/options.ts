export class Options {
    skipMenu = false;
    showCollider = false;
    playBGM = true;

    private parseBoolean(def: boolean, paramValue: string | null): boolean {
        if (paramValue === null) {
            return def;
        }
        switch (paramValue.trim().toLowerCase()) {
            case '1':
            case 'on':
            case 'true':
                return true;
            case '0':
            case 'off':
            case 'false':
                return false;
        }
        return def;
    }

    constructor() {
        const params = new URLSearchParams(window.location.search);
        this.skipMenu = this.parseBoolean(
            this.skipMenu,
            params.get('skipMenu'),
        );
        this.showCollider = this.parseBoolean(
            this.showCollider,
            params.get('showCollider'),
        );
        this.playBGM = this.parseBoolean(this.playBGM, params.get('playBGM'));
    }
}

const options = new Options();
export default options;
