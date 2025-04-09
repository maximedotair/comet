import { DynamoDBClient } from "@aws-sdk/client-dynamodb";
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { v4 as uuidv4 } from 'uuid';

const dynamoDbClient = new DynamoDBClient({});
const ddbDocClient = DynamoDBDocumentClient.from(dynamoDbClient);
const snsClient = new SNSClient({});

// Ne pas lire les variables d'env ici
// const PRODUCTS_TABLE_NAME = process.env.PRODUCTS_TABLE_NAME;
// const PRODUCT_EVENTS_TOPIC_ARN = process.env.PRODUCT_EVENTS_TOPIC_ARN;

interface Product {
  productId: string;
  name: string;
  description?: string;
  price: number;
  createdAt: string;
}

export const handler = async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
  // Lire les variables d'env ici, à chaque invocation
  const productsTableName = process.env.PRODUCTS_TABLE_NAME;
  const productEventsTopicArn = process.env.PRODUCT_EVENTS_TOPIC_ARN;

  if (!productsTableName || !productEventsTopicArn) {
    console.error("Configuration error: Missing environment variables.");
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error: Configuration missing." }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  if (!event.body) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Bad request: Missing request body." }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  let productData;
  try {
    productData = JSON.parse(event.body);
  } catch (error) {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Bad request: Invalid JSON format." }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  // Validation simple (à améliorer pour la production)
  if (!productData.name || typeof productData.name !== 'string' || !productData.price || typeof productData.price !== 'number') {
    return {
      statusCode: 400,
      body: JSON.stringify({ message: "Bad request: Missing or invalid product name or price." }),
      headers: { 'Content-Type': 'application/json' },
    };
  }

  const timestamp = new Date().toISOString();
  const productId = uuidv4();

  const newProduct: Product = {
    productId: productId,
    name: productData.name,
    description: productData.description, // Optionnel
    price: productData.price,
    createdAt: timestamp,
  };

  // Insertion dans DynamoDB
  const putParams = {
    TableName: productsTableName,
    Item: newProduct,
  };

  try {
    await ddbDocClient.send(new PutCommand(putParams));
    console.log(`Product ${productId} inserted successfully.`);

    // Publication de l'événement dans SNS
    const snsPayload = {
        productId: newProduct.productId,
        name: newProduct.name,
        price: newProduct.price,
        // Ajoutez d'autres informations pertinentes pour l'email
    };
    const publishParams = {
      TopicArn: productEventsTopicArn,
      Message: JSON.stringify(snsPayload),
      MessageAttributes: {
        eventType: {
          DataType: 'String',
          StringValue: 'ProductCreated',
        },
      },
    };
    await snsClient.send(new PublishCommand(publishParams));
    console.log(`Event published to SNS for product ${productId}.`);

    return {
      statusCode: 201,
      body: JSON.stringify(newProduct),
      headers: { 'Content-Type': 'application/json' },
    };
  } catch (error) {
    console.error("Error inserting product or publishing event:", error);
    // Idéalement, implémenter une logique de compensation ou de re-tentative ici
    return {
      statusCode: 500,
      body: JSON.stringify({ message: "Internal server error while processing the product." }),
      headers: { 'Content-Type': 'application/json' },
    };
  }
}; 