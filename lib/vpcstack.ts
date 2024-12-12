import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';

export class VpcStack extends cdk.Stack {
  public readonly vpc: ec2.Vpc;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const isProd = this.node.tryGetContext('env') === 'prod';

    this.vpc = new ec2.Vpc(this, 'VPC', {
      maxAzs: 3,
      natGatewayProvider: isProd
        ? ec2.NatProvider.gateway()
        : ec2.NatProvider.instanceV2({
            instanceType: new ec2.InstanceType("t3.micro"),
          }),
      subnetConfiguration: [
        { subnetType: ec2.SubnetType.PUBLIC, name: 'Public', cidrMask: 24 },
        { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS, name: 'Private', cidrMask: 24 },
        { subnetType: ec2.SubnetType.PRIVATE_ISOLATED, name: 'Isolated', cidrMask: 24 },
      ],
    });
  }
}
