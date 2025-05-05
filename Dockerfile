FROM node:20.12.1

WORKDIR /src

COPY . /src

RUN npm install

CMD ["npm", "start"]

EXPOSE 3000
