import type {View} from './repository';
export type DemoScenario = 'planned'|'empty'|'overloaded';
export type Demo = Omit<View,'scenario'> & {scenario:DemoScenario};
export function mountR02(initial:View|Demo, persist?:(before:View,next:View,planDate?:string)=>Promise<View>):void;
