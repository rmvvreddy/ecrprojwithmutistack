import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { DockerImageAsset, Platform } from 'aws-cdk-lib/aws-ecr-assets'
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam'


interface EcsStackProps extends cdk.StackProps {
  vpc: ec2.Vpc;
  repository: ecr.Repository;
  
}

export class EcsStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: EcsStackProps) {
    super(scope, id, props);

    const { vpc, repository } = props;

    // Create a security group for RDS
    const rdsSecurityGroup = new ec2.SecurityGroup(this, 'RdsSG', {
      vpc,
    });
    

    // Create a secret manager for RDS instance
    const rdsSecret = new secretsmanager.Secret(this, 'RdsSecret', {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ username: 'admin' }),
        generateStringKey: 'password',
        excludeCharacters: '/@"\'\\',
      },
    });

    // Create RDS instance in isolated subnet
    const rdsInstance = new rds.DatabaseInstance(this, 'RdsInstance', {
      engine: rds.DatabaseInstanceEngine.mysql({ version: rds.MysqlEngineVersion.VER_8_0_32 }),
      vpc,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_ISOLATED },
      securityGroups: [rdsSecurityGroup],
      credentials: rds.Credentials.fromSecret(rdsSecret),
      databaseName: 'MyDatabase',
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
    });

    
    // Create ALB in public subnets
    const loadBalancer = new elbv2.ApplicationLoadBalancer(this, 'Alb', {
      vpc,
      internetFacing: true,
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
     
    });

    // Create an ECS Fargate cluster in private subnets and ECS image from ECR
    const cluster = new ecs.Cluster(this, 'Cluster', {
      vpc,
    });

    // Create an IAM role for ECS task execution
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
        assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      });
  
      // Add necessary permissions to the IAM role
      taskExecutionRole.addToPolicy(new iam.PolicyStatement({
        actions: [
          'ecr:GetDownloadUrlForLayer',
          'ecr:BatchGetImage',
          'ecr:BatchCheckLayerAvailability',
          'ecr:GetAuthorizationToken',
          
        ],
        resources: ['*'],
      }));
  

   

    // Create an ECS task definition
    const taskDefinition = new ecs.FargateTaskDefinition(this, 'TaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      executionRole: taskExecutionRole,
    });

    // Create a CloudWatch log group for ECS logs
    const logGroup = new logs.LogGroup(this, 'LogGroup', {
      retention: logs.RetentionDays.ONE_WEEK,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
    });

    const repoUrl = ssm.StringParameter.valueForStringParameter(this, '/ecr/repo-url');

    // Create a container definition
    const container = taskDefinition.addContainer('web', {
      image: ecs.ContainerImage.fromRegistry(repoUrl),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'ecs-fargate-app',
        logGroup,
      }),
      environment: {
        RDS_ENDPOINT: rdsInstance.dbInstanceEndpointAddress,
      },
      secrets: {
        RDS_USERNAME: ecs.Secret.fromSecretsManager(rdsSecret, 'username'),
        RDS_PASSWORD: ecs.Secret.fromSecretsManager(rdsSecret, 'password'),
      },
    });

    const ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
      vpc,
    
    });
    rdsSecurityGroup.addIngressRule(ecsSecurityGroup, ec2.Port.tcp(3306), 'Allow traffic from ECS');

   
    // Create an ECS Fargate service with Deployment Circuit Breaker
    const ecsService = new ecs.FargateService(this, 'Service', {
      cluster,
      taskDefinition,
      vpcSubnets: { subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS },
      securityGroups: [ecsSecurityGroup],
      circuitBreaker: {
        rollback: true,
      },
    });

    // ECS port mapping to 3000
    container.addPortMappings({
      containerPort: 3000,
    });

    // Integrate ECS Service with ALB
    const listener = loadBalancer.addListener('Listener', {
      port: 80,
      open: true,
    });

    listener.addTargets('ECS', {
      port: 80,
      targets: [ecsService.loadBalancerTarget({
        containerName: 'web',
        containerPort: 3000,
      })],
      healthCheck: {
        path: "/",
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(5),
        healthyHttpCodes: "200-299",
      },
    });

   

    // Create an API Gateway and integrate it with the ALB
    const api = new apigateway.RestApi(this, 'ApiGateway', {
      restApiName: 'Service API',
      description: 'API Gateway on top of ALB',
    });

    const integration = new apigateway.Integration({
      type: apigateway.IntegrationType.HTTP_PROXY,
      uri: `http://${loadBalancer.loadBalancerDnsName}`,
      integrationHttpMethod: 'ANY',
    });

    api.root.addMethod('ANY', integration);

    // Output the Load Balancer DNS
    new cdk.CfnOutput(this, 'LoadBalancerDNS', {
      value: loadBalancer.loadBalancerDnsName,
    });

    // Output the API Gateway URL
    new cdk.CfnOutput(this, 'ApiGatewayURL', {
      value: api.url,
    });
  }
}
