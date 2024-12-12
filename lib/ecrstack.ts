import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';
import * as ssm from 'aws-cdk-lib/aws-ssm';

export class EcrStack extends cdk.Stack {
  public readonly repository: ecr.Repository;
  public readonly myimage: DockerImageAsset;

  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const myimage = new DockerImageAsset(this, 'CDKDockerImage', {
      directory: path.join(__dirname, '../appcode'),
      
    });
     new ssm.StringParameter(this, 'EcrRepoUrlParameter', {
        parameterName: '/ecr/repo-url', // Path for the parameter in SSM
        stringValue: this.myimage.imageUri, // Value to store (ECR repository URI)
        description: 'The URL of the ECR repository',
      });

 
  }
}
