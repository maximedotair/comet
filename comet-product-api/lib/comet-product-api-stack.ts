import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subscriptions from 'aws-cdk-lib/aws-sns-subscriptions';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';

export class CometProductApiStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // Lire les configurations depuis les variables d'environnement
    // Ces variables sont peuplées par `dotenv` localement (via `bin/...ts`)
    // ou doivent être définies dans l'environnement d'exécution (ex: CI/CD)
    const senderEmailAddress = process.env.SENDER_EMAIL_ADDRESS;
    const recipientEmailAddress = process.env.RECIPIENT_EMAIL_ADDRESS;

    // Valider que les variables requises sont présentes
    if (!senderEmailAddress) {
        throw new Error('Variable d\'environnement SENDER_EMAIL_ADDRESS manquante.');
    }
    if (!recipientEmailAddress) {
        throw new Error('Variable d\'environnement RECIPIENT_EMAIL_ADDRESS manquante.');
    }

    // Table DynamoDB pour stocker les produits
    const productsTable = new dynamodb.Table(this, 'ProductsTable', {
      partitionKey: { name: 'productId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST, // Rentable pour des charges variables
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Supprimer la table lors de la suppression du stack (pour le dev)
    });

    // Sujet SNS pour notifier l'ajout de produits
    const productEventsTopic = new sns.Topic(this, 'ProductEventsTopic', {
      displayName: 'Product Insertion Events Topic',
    });

    // Fonction Lambda pour insérer les produits
    const productInserterLambda = new lambda.Function(this, 'ProductInserterLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/product-inserter')),
      environment: {
        PRODUCTS_TABLE_NAME: productsTable.tableName,
        PRODUCT_EVENTS_TOPIC_ARN: productEventsTopic.topicArn,
      },
    });

    // Accorder les permissions à la Lambda d'insertion
    productsTable.grantWriteData(productInserterLambda); // Écrire dans DynamoDB
    productEventsTopic.grantPublish(productInserterLambda); // Publier dans SNS

    // Fonction Lambda pour envoyer les emails (utilise les variables lues plus haut)
    const emailSenderLambda = new lambda.Function(this, 'EmailSenderLambda', {
      runtime: lambda.Runtime.NODEJS_18_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../lambda/email-sender')),
      environment: {
        // Injecter les variables d'environnement lues au début
        SENDER_EMAIL_ADDRESS: senderEmailAddress,
        RECIPIENT_EMAIL_ADDRESS: recipientEmailAddress,
      },
    });

    // Accorder la permission d'envoyer des emails via SES
    emailSenderLambda.addToRolePolicy(new iam.PolicyStatement({
      actions: ['ses:SendEmail', 'ses:SendRawEmail'],
      resources: ['*'], // Attention : pour la production, restreindre les ressources si possible
      effect: iam.Effect.ALLOW,
    }));

    // Abonner la Lambda d'envoi d'email au sujet SNS
    productEventsTopic.addSubscription(new subscriptions.LambdaSubscription(emailSenderLambda));

    // API Gateway pour exposer l'endpoint
    const api = new apigateway.RestApi(this, 'ProductsApi', {
      restApiName: 'Products Service',
      description: 'Handles product insertions.',
      deployOptions: { // Optionnel: pour avoir un stage 'prod'
        stageName: 'prod',
      },
      defaultCorsPreflightOptions: { // Activer CORS pour les tests depuis un navigateur
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS, // Autorise POST
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token'], // Headers standards
      },
      // Activer la génération de la spec OpenAPI
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL],
      },
    });

    // Définition du modèle pour le corps de la requête POST /products
    const productModel = api.addModel('ProductInputModel', {
      contentType: 'application/json',
      modelName: 'ProductInputModel',
      schema: {
        schema: apigateway.JsonSchemaVersion.DRAFT4,
        title: 'ProductInput',
        type: apigateway.JsonSchemaType.OBJECT,
        required: ['name', 'price'],
        properties: {
          name: { type: apigateway.JsonSchemaType.STRING, description: 'Nom du produit' },
          description: { type: apigateway.JsonSchemaType.STRING, description: 'Description optionnelle du produit' },
          price: { type: apigateway.JsonSchemaType.NUMBER, description: 'Prix du produit', format: 'float' },
        },
      },
    });

    // Définition du modèle pour la réponse 201 Created
    const productResponseModel = api.addModel('ProductResponseModel', {
        contentType: 'application/json',
        modelName: 'ProductResponseModel',
        schema: {
          schema: apigateway.JsonSchemaVersion.DRAFT4,
          title: 'ProductResponse',
          type: apigateway.JsonSchemaType.OBJECT,
          properties: {
            productId: { type: apigateway.JsonSchemaType.STRING },
            name: { type: apigateway.JsonSchemaType.STRING },
            description: { type: apigateway.JsonSchemaType.STRING },
            price: { type: apigateway.JsonSchemaType.NUMBER },
            createdAt: { type: apigateway.JsonSchemaType.STRING, format: 'date-time' },
          },
        },
      });

    // Intégration entre API Gateway et la Lambda d'insertion
    const productInserterIntegration = new apigateway.LambdaIntegration(productInserterLambda);

    // Ressource '/products'
    const productsResource = api.root.addResource('products');

    // Méthode POST sur '/products' avec validation du modèle
    productsResource.addMethod('POST', productInserterIntegration, {
       // Validation du corps de la requête
       requestValidatorOptions: {
           requestValidatorName: 'validate-body',
           validateRequestBody: true,
       },
       requestModels: {
           'application/json': productModel,
       },
       // Documentation des réponses
       methodResponses: [
           {
               statusCode: '201',
               responseParameters: {
                   'method.response.header.Content-Type': true,
               },
               responseModels: {
                   'application/json': productResponseModel,
               },
           },
           {
               statusCode: '400', // Bad Request (validation error)
               responseModels: { 'application/json': apigateway.Model.ERROR_MODEL },
           },
           {
                statusCode: '500', // Internal Server Error
                responseModels: { 'application/json': apigateway.Model.ERROR_MODEL },
           }
       ],
    });

    // Afficher l'URL de l'API après le déploiement
    new cdk.CfnOutput(this, 'ApiUrlOutput', {
      value: api.url, // Donne l'URL de base de l'API
      description: 'URL of the Products API Gateway endpoint (add /products for the resource)',
    });

    // Output pour exporter la spec OpenAPI
    new cdk.CfnOutput(this, 'OpenApiSpecExportUrl', {
        value: `https://${api.restApiId}.execute-api.${this.region}.amazonaws.com/${api.deploymentStage.stageName}/swagger.json`,
        description: 'URL pour télécharger la spécification OpenAPI (peut prendre quelques minutes après déploiement)',
      });

    new cdk.CfnOutput(this, 'ProductsTableNameOutput', {
        value: productsTable.tableName,
        description: 'Name of the Products DynamoDB table',
      });

    new cdk.CfnOutput(this, 'ProductEventsTopicArnOutput', {
        value: productEventsTopic.topicArn,
        description: 'ARN of the Product Events SNS topic',
      });
  }
}

// Supprimer ou commenter le code d'exemple initial s'il existe
// import * as sqs from 'aws-cdk-lib/aws-sqs';
//
// export class CometProductApiStack extends cdk.Stack {
//   constructor(scope: Construct, id: string, props?: cdk.StackProps) {
//     super(scope, id, props);
//
//     // The code that defines your stack goes here
//
//     // example resource
//     // const queue = new sqs.Queue(this, 'CometProductApiQueue', {
//     //   visibilityTimeout: cdk.Duration.seconds(300)
//     // });
//   }
// } 