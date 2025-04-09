import { handler } from './index'; // Importer le handler de la Lambda
import { DynamoDBDocumentClient, PutCommand } from "@aws-sdk/lib-dynamodb";
import { SNSClient, PublishCommand } from "@aws-sdk/client-sns";
import { mockClient } from 'aws-sdk-client-mock'; // Utilisation de l'outil de mock
import { APIGatewayProxyEvent } from 'aws-lambda';

// --- Configuration du Mock --- 
// Simuler les clients DynamoDB et SNS
// 'mockClient' permet d'intercepter les commandes envoyées à ces clients
const ddbMock = mockClient(DynamoDBDocumentClient);
const snsMock = mockClient(SNSClient);

// Simuler uuid pour obtenir des IDs prévisibles dans les tests
// Note: Si vous utilisez import { v4 as uuidv4 } from 'uuid';
jest.mock('uuid', () => ({
  v4: () => 'test-uuid-1234', // Retourne toujours le même UUID pour les tests
}));

// --- Tests --- 
describe('ProductInserter Lambda Handler', () => {

  // Réinitialiser les mocks avant chaque test pour éviter les interférences
  beforeEach(() => {
    ddbMock.reset();
    snsMock.reset();
    // Configurer les variables d'environnement nécessaires pour la Lambda
    process.env.PRODUCTS_TABLE_NAME = 'TestProductsTable';
    process.env.PRODUCT_EVENTS_TOPIC_ARN = 'arn:aws:sns:us-east-1:123456789012:TestProductEventsTopic';
  });

  // Nettoyer les variables d'environnement après les tests
  afterEach(() => {
    delete process.env.PRODUCTS_TABLE_NAME;
    delete process.env.PRODUCT_EVENTS_TOPIC_ARN;
  });

  // --- Cas de Succès --- 
  test('devrait insérer le produit et publier sur SNS avec succès pour une requête valide', async () => {
    // Arrange: Préparer les données d'entrée et simuler les réponses réussies
    const validEvent: Partial<APIGatewayProxyEvent> = {
      body: JSON.stringify({
        name: 'Test Product',
        price: 19.99,
        description: 'A great test product'
      })
    };

    // Simuler une réponse réussie de DynamoDB (PutCommand)
    ddbMock.on(PutCommand).resolves({}); 
    // Simuler une réponse réussie de SNS (PublishCommand)
    snsMock.on(PublishCommand).resolves({ MessageId: 'sns-message-id' });

    // Act: Exécuter le handler de la Lambda
    const result = await handler(validEvent as APIGatewayProxyEvent);

    // Assert: Vérifier les résultats
    expect(result.statusCode).toBe(201);
    const body = JSON.parse(result.body);
    expect(body.productId).toBe('test-uuid-1234'); // Vérifier l'UUID mocké
    expect(body.name).toBe('Test Product');
    expect(body.price).toBe(19.99);
    expect(body.createdAt).toBeDefined(); // Vérifier que la date est définie

    // Assert: Vérifier que DynamoDB et SNS ont été appelés une fois avec la bonne commande
    expect(ddbMock.calls()).toHaveLength(1);
    // Vérifier que la commande envoyée à DynamoDB était bien une instance de PutCommand
    expect(ddbMock.call(0).firstArg).toBeInstanceOf(PutCommand); 

    expect(snsMock.calls()).toHaveLength(1);
    // Vérifier que la commande envoyée à SNS était bien une instance de PublishCommand
    expect(snsMock.call(0).firstArg).toBeInstanceOf(PublishCommand);
  });

  // --- Cas d'Erreur de Validation --- 
  test('devrait retourner 400 si le corps de la requête est manquant', async () => {
    const event: Partial<APIGatewayProxyEvent> = { body: null }; // Pas de corps
    const result = await handler(event as APIGatewayProxyEvent);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Missing request body');
  });

  test('devrait retourner 400 si le JSON est invalide', async () => {
    const event: Partial<APIGatewayProxyEvent> = { body: '{ invalid json ' };
    const result = await handler(event as APIGatewayProxyEvent);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Invalid JSON format');
  });

  test('devrait retourner 400 si le nom du produit est manquant', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      body: JSON.stringify({ price: 10 })
    };
    const result = await handler(event as APIGatewayProxyEvent);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Missing or invalid product name or price');
  });

   test('devrait retourner 400 si le prix est manquant ou invalide', async () => {
    const event: Partial<APIGatewayProxyEvent> = {
      body: JSON.stringify({ name: 'Test Product', price: 'invalid' })
    };
    const result = await handler(event as APIGatewayProxyEvent);
    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).message).toContain('Missing or invalid product name or price');
  });

  // --- Cas d'Erreur Interne --- 
  test('devrait retourner 500 si DynamoDB échoue', async () => {
    // Arrange
    const validEvent: Partial<APIGatewayProxyEvent> = {
      body: JSON.stringify({ name: 'Test Product', price: 50 })
    };
    // Simuler une erreur de DynamoDB
    ddbMock.on(PutCommand).rejects(new Error('DynamoDB Error'));
    snsMock.on(PublishCommand).resolves({}); // SNS ne sera pas appelé mais on le configure

    // Act
    const result = await handler(validEvent as APIGatewayProxyEvent);

    // Assert
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).message).toContain('Internal server error');
    // Vérifier que DynamoDB a été appelé
    expect(ddbMock.calls()).toHaveLength(1);
    expect(ddbMock.call(0).firstArg).toBeInstanceOf(PutCommand);
    // Vérifier que SNS n'a pas été appelé
    expect(snsMock.calls()).toHaveLength(0);
  });

  test('devrait retourner 500 si SNS échoue après succès DynamoDB', async () => {
    // Arrange
    const validEvent: Partial<APIGatewayProxyEvent> = {
      body: JSON.stringify({ name: 'Test Product', price: 60 })
    };
    ddbMock.on(PutCommand).resolves({}); // DynamoDB réussit
    // Simuler une erreur SNS
    snsMock.on(PublishCommand).rejects(new Error('SNS Error'));

    // Act
    const result = await handler(validEvent as APIGatewayProxyEvent);

    // Assert
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).message).toContain('Internal server error');
    // Vérifier que DynamoDB et SNS ont été appelés
    expect(ddbMock.calls()).toHaveLength(1);
    expect(ddbMock.call(0).firstArg).toBeInstanceOf(PutCommand);
    expect(snsMock.calls()).toHaveLength(1);
    expect(snsMock.call(0).firstArg).toBeInstanceOf(PublishCommand);
  });

  test('devrait retourner 500 si les variables d\'environnement manquent', async () => {
    // Arrange
    delete process.env.PRODUCTS_TABLE_NAME; // Supprimer une variable requise
    const event: Partial<APIGatewayProxyEvent> = { 
        body: JSON.stringify({ name: 'Test', price: 1 })
     };

    // Act
    const result = await handler(event as APIGatewayProxyEvent);

    // Assert
    expect(result.statusCode).toBe(500);
    expect(JSON.parse(result.body).message).toContain('Configuration missing');
  });

}); 