#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CometProductApiStack } from '../lib/comet-product-api-stack';

// Charger les variables d'environnement depuis le fichier .env à la racine
// Cela permet de configurer des choses localement (ex: emails) sans les coder en dur
// `dotenv` ne fera rien si le fichier .env n'existe pas (ex: en CI/CD)
import * as dotenv from 'dotenv';
dotenv.config(); 

const app = new cdk.App();
new CometProductApiStack(app, 'CometProductApiStack', {
  /* La configuration 'env' lie ce stack à un compte/région AWS spécifique.
   * Décommentez l'une des lignes suivantes si votre stack dépend de la région/compte,
   * ou laissez commenté pour un déploiement agnostique (certaines fonctions CDK désactivées).
   */
  // env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }, // Utilise la config CLI
  // env: { account: '123456789012', region: 'us-east-1' }, // Compte/Région spécifiques
  
  /* Pour plus d'informations (en anglais), voir :
   * https://docs.aws.amazon.com/cdk/latest/guide/environments.html
   */
}); 