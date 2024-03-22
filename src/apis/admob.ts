import consola from 'consola'
import { chromium, type Cookie } from 'playwright'
import type { AdFormat, Platform } from '../base'
import type { AdmobAuthData } from './google'
import { ofetch, FetchError } from 'ofetch'
export type DynamicObject = Record<string, any>
export type EcpmFloor = {
    mode: 'Google Optimize',
    level: 'High' | 'Medium' | 'Low'
} | {
    mode: 'Manual floor',
    value: number
    currency: 'USD'
} | {
    mode: 'Disabled'
}
interface AdmobAPIConfig {
    auth: AdmobAuthData
}
function createDynamicObject<T extends object>(target: T = {} as T): DynamicObject {
    const handler: ProxyHandler<T> = {
        get(target, property, receiver) {
            if (property === '__target__') {
                return target;
            }
            // return a proxy if the property doesn't exist
            if (!(property in target)) {
                const emptyObject = {};
                Reflect.set(target, property, emptyObject);
                return new Proxy(emptyObject, handler);
            }
            return Reflect.get(target, property, receiver);
        },
        set(target, property, value) {
            return Reflect.set(target, property, value);
        }
    };

    return new Proxy(target, handler);
}

/**
 * ## Ad Format
 *   Rewarded interstitial
 *   f.req: {"1":{"2":"7957499881","3":"test2","14":8,"16":[2,1],"17":true,"18":{"1":"1","2":"Reward","3":true},"23":{"1":2,"2":3},"27":{"1":1}}}
 *
 *   Interstitial
 *   f.req: {"1":{"2":"7957499881","3":"test4","14":1,"16":[0,1,2],"23":{"1":2,"2":3},"27":{"1":1}}}
 *
 *   Rewarded
 *   f.req: {"1":{"2":"7957499881","3":"test5","14":1,"16":[2,1],"17":true,"18":{"1":"1","2":"Reward","3":true},"23":{"1":2,"2":3},"27":{"1":1}}}
 *
 *   Banner
 *   f.req: {"1":{"2":"7957499881","3":"tsete6","14":0,"16":[0,1,2],"21":true,"23":{"1":2,"2":3},"27":{"1":1}}}
 * 
 *   App Open
 *   f.req: {"1":"7867355490","2":"3679512360","3":"App open","9":false,"11":false,"14":7,"15":true,"16":[0,1,2],"17":false,"21":false,"22":{},"23":{"1":3,"3":{"1":{"1":"2500000","2":"USD"}}},"27":{"1":1}}
 * ## Ecpm Floor
 * 
 *   23: {
 *       // Mode: 1 - disabled, 2 - Google Optimize, 3 - Manual floor
 *       1: 3,
 *       // For Google Optimize: 1 - High, 2 - Medium, 3 - Low
 *       // 2: 3,
 *       // For Manual floor
 *       3: {
 *           1: {
 *               1: ecpmFloor * 1000000, "2": "USD"
 *           }
 *       }
 *   },
 * 
 */
function createBody(options: Partial<AdUnitOptions>) {
    const body = createDynamicObject()

    // handle app id
    body[1][2] = options.appId

    // handle display name
    body[1][3] = options.name

    // ecpm floor
    if (options.ecpmFloor) {
        switch (options.ecpmFloor.mode) {
            case 'Google Optimize':
                body[1][23] = {
                    1: 2,
                    2: options.ecpmFloor.level === 'High' ? 1 : options.ecpmFloor.level === 'Medium' ? 2 : 3,
                }
                break
            case 'Manual floor':
                body[1][23] = {
                    1: 3,
                    3: {
                        1: {
                            1: options.ecpmFloor.value * 1000000,
                            2: options.ecpmFloor.currency
                        }
                    }
                }
                break
            case 'Disabled':
                body[1][23] = {
                    1: 1
                }
                break
        }
    }

    // handle ad format
    switch (options.adFormat) {
        case 'Banner':
            body[1][14] = 0
            body[1][16] = [0, 1, 2]
            body[1][21] = true
            break
        case 'Interstitial':
            body[1][14] = 1
            body[1][16] = [0, 1, 2]
            break
        case 'Rewarded':
            body[1][14] = 1
            body[1][16] = [2, 1]
            body[1][17] = true
            body[1][18] = {
                1: '1',
                2: 'Reward',
                3: true
            }
            break
        case 'RewardedInterstitial':
            body[1][14] = 8
            body[1][16] = [2, 1]
            body[1][17] = true
            body[1][18] = {
                1: '1',
                2: 'Reward',
                3: true
            }
            break
        case 'AppOpen':
            body[1][14] = 7
            body[1][16] = [0, 1, 2]
            body[1][15] = true
    }

    // handle frequency cap
    if (options.frequencyCap) {
        body[1][23][1] = options.frequencyCap.impressions
        body[1][23][2] = options.frequencyCap.durationValue
        switch (options.frequencyCap.durationUnit) {
            case 'minutes':
                body[1][23][1] = 1
                break
            case 'hours':
                body[1][23][1] = 2
                break
            case 'days':
                body[1][23][1] = 3
                break
        }
    }


    // unknown: always set this
    body[1][27] = {
        1: 1
    }

    return body.__target__
}

export interface AdUnit {
    adUnitId: string
    adUnitPublicId: string
    appId: string
    name: string
    adFormat: AdFormat
    ecpmFloor: EcpmFloor
}

interface AdUnitOptions {
    appId: string
    name: string
    adFormat: AdFormat
    frequencyCap?: {
        impressions: number,
        durationValue: number,
        durationUnit: 'minutes' | 'hours' | 'days'
    }
    ecpmFloor: EcpmFloor
}

interface AdmobAppResult {
    appId: string
    name: string
    platform: Platform
    status: 'Active' | 'Inactive'
    packageName: string
    projectId: string
}


interface AdmobPublisher {
    email: string
    publisherId: string
}

const formatIdMap: Record<number, AdFormat> = {
    0: 'Banner',
    1: 'Interstitial',
    5: 'Rewarded',
    8: 'RewardedInterstitial'
}
const platformIdMap: Record<number, Platform> = {
    1: 'iOS',
    2: 'Android'
}
export class API {
    private publisher: AdmobPublisher | undefined
    constructor(private config: AdmobAPIConfig) { }

    async getPublicAdUnitId(adUnitId: string) {
        const publisher = await this.getPublisher()
        return `ca-app-${publisher.publisherId}/${adUnitId}`
    }

    async fetch(url: string, body: Record<string, any> = {}) {
        const { auth } = this.config
        try {
            const json = await ofetch(url, {
                method: 'POST',
                headers: {
                    'content-type': 'application/x-www-form-urlencoded',
                    ...auth,
                },
                body: 'f.req=' + encodeURIComponent(JSON.stringify(body)),
                responseType: 'json'
            })
            return json
        } catch (e) {
            if (e instanceof FetchError) {
                // consola.log(e.data)
                try {
                    const adMobServerException = e.data['2']
                    // message: "Insufficient Data API quota. API Clients: ADMOB_APP_MONETIZATION. Quota Errors: Quota Project: display-ads-storage, Group: ADMOB_APP_MONETIZATION-ADD-AppAdUnit-perApp, User: 327352636-1598902297, Quota status: INSUFFICIENT_TOKENS"
                    const message = adMobServerException.match(/message: "([^"]+)"/)?.[1]
                    throw new Error('Failed to list apps: ' + message)
                } catch (e) {
                    if (e instanceof Error) {
                        throw new Error('Failed to list apps: ' + e.message)
                    }
                }
            } else {
                throw e
            }
        }
    }

    parseAdUnitResponse(response: any) {
        // handle ad format
        let adFormat: AdFormat
        if (response[14] == 1 && response[17] == true) {
            adFormat = 'Rewarded'
        } else if (response[14] == 8 && response[17] == true) {
            adFormat = 'RewardedInterstitial'
        } else if (response[14] == 1 && !response[17]) {
            adFormat = 'Interstitial'
        } else if (response[14] == 0 && response[21] == true) {
            adFormat = 'Banner'
        } else if (response[14] == 7 && response[15] == true) {
            adFormat = 'AppOpen'
        } else {
            throw new Error('Unknown ad format: ' + JSON.stringify(response))
        }


        // handle ecpm floors
        let ecpmFloor: EcpmFloor
        switch (response[23][1]) {
            case 1:
                ecpmFloor = {
                    mode: 'Disabled'
                }
                break
            case 2:
                ecpmFloor = {
                    mode: 'Google Optimize',
                    level: response[23][2] === 1 ? 'High' : response[23][2] === 2 ? 'Medium' : 'Low'
                }
                break
            case 3:
                ecpmFloor = {
                    mode: 'Manual floor',
                    value: response[23][3][1][1] / 1000000,
                    currency: response[23][3][1][2]
                }
                break
            default:
                throw new Error('Unknown ecpm floor mode')
        }
        return {
            adUnitId: response[1] as string,
            appId: response[2] as string,
            name: String(response[3]),
            adFormat,
            ecpmFloor,
        } as AdUnit
    }

    async getListOfAdUnits(appId: string) {
        // const [appIdPrefix, appIdShort] = appId.split('~')
        const body = {
            "1": [appId]
        }
        const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/List?authuser=1&authuser=1&authuser=1&f.sid=4269709555968964600", body);
        if (!Array.isArray(json[1]) || json[1].length === 0) {
            return [];
        }
        const result = [] as AdUnit[];
        for (const entry of json[1]) {
            const adUnit = this.parseAdUnitResponse(entry)
            result.push(adUnit)
        }
        return result
    }

    async createAdUnit(options: AdUnitOptions) {
        const { appId, name, adFormat, frequencyCap, ecpmFloor } = options
        // const [appIdPrefix, appIdShort] = appId.split('~')
        const body = createBody({
            appId: appId,
            name,
            adFormat,
            frequencyCap,
            ecpmFloor
        })

        const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Create?authuser=1&authuser=1&authuser=1&f.sid=3583866342012525000", body);
        return this.parseAdUnitResponse(json[1])
    }

    // body: f.req: {"1":{"1":"8767339703","2":"1598902297","3":"cubeage/gameEnd/ecpm/6","9":false,"11":false,"14":1,"15":true,"16":[0,1,2],"17":false,"21":false,"22":{},"23":{"1":3,"3":{"1":{"1":"1000000","2":"USD"}}},"27":{"1":1}},"2":{"1":["cpm_floor_settings"]}}
    async updateAdUnit(appId: string, adUnitId: string, options: Partial<AdUnitOptions>) {
        const { name, adFormat, frequencyCap, ecpmFloor } = options

        // get original data
        const adUnit = await this.getListOfAdUnits(appId).then(x => x.find(x => x.adUnitId === adUnitId))
        if (!adUnit) {
            throw new Error('Ad unit not found')
        }

        // const [appIdPrefix, appIdShort] = appId.split('~')
        const body = createBody({
            ...adUnit,
            name,
            adFormat,
            frequencyCap,
            ecpmFloor
        })

        body[1][1] = adUnitId

        if (options.ecpmFloor) {
            body[2] = {
                1: ["cpm_floor_settings"]
            }
        }

        const response = await this.fetch("https://apps.admob.com/inventory/_/rpc/AdUnitService/Update?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000", body);
    }

    async bulkRemoveAdUnits(adUnitIds: string[]) {
        // const adUnitIdsShort = adUnitIds.map(x => x.split('/').pop())
        const json = await this.fetch(
            "https://apps.admob.com/inventory/_/rpc/AdUnitService/BulkRemove?authuser=1&authuser=1&authuser=1&f.sid=-4819060855550730000",
            {
                "1": adUnitIds,
                "2": 1
            });
    }

    async listApps() {
        const json = await this.fetch("https://apps.admob.com/inventory/_/rpc/InventoryEntityCollectionService/GetApps?authuser=1&authuser=1&authuser=1&f.sid=-2228407465145415000")
        return json[1].map((x: any) => ({
            appId: x[1],
            name: x[2],
            platform: x[3] == 1 ? 'iOS' : 'Android',
            status: x[19] ? 'Inactive' : 'Active',
            packageName: x[22],
            projectId: x?.[23]?.[2]?.[1]
        } as AdmobAppResult))
    }

    async getPublisher() {
        if (this.publisher) {
            return this.publisher
        }
        const json = await this.fetch('https://apps.admob.com/publisher/_/rpc/PublisherService/Get?authuser=1&authuser=1&authuser=1&f.sid=2563678571570077000')
        this.publisher = {
            email: json[1][1][1],
            publisherId: json[1][2][1]
        }
        return this.publisher
    }

    async getMediationGroups() {
        const json = await this.fetch('https://apps.admob.com/mediationGroup/_/rpc/MediationGroupService/List?authuser=1&authuser=1&authuser=1&f.sid=-2500048687334755000')
        return json[1].map((x: any) => {
            return ({
                id: x[1],
                name: x[2],
                platform: platformIdMap[x[4][1]],
                format: formatIdMap[x[4][2]],
            })
        })
    }
}
