#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { VpcStack } from '../lib/vpcstack';
import { EcrStack } from '../lib/ecrstack';
import { EcsStack } from '../lib/ecsfargate';



const app = new cdk.App();

const vpcStack = new VpcStack(app, 'VpcStack');
const ecrStack = new EcrStack(app, 'EcrStack');

new EcsStack(app, 'EcsStack', {
  vpc: vpcStack.vpc, 
  repository: ecrStack.repository,
 
});
